import Anthropic from "@anthropic-ai/sdk";
import { exec } from "child_process";
import { promisify } from "util";
import * as readline from "readline";
import * as dotenv from "dotenv";

dotenv.config();

const execAsync = promisify(exec);
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────
//  TOOL DEFINITIONS
//  Claude reads these descriptions to decide
//  which tool to call — write them clearly!
// ─────────────────────────────────────────
const tools = [
  {
    name: "get_pm2_status",
    description:
      "Returns the current status of all PM2 processes running on the server. Use this when the user asks about server status, running processes, uptime, memory usage, or deployment health.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_pm2_logs",
    description:
      "Fetches the most recent PM2 logs for a given process. Use this when the user asks about errors, crashes, logs, or wants to debug why something isn't working.",
    input_schema: {
      type: "object",
      properties: {
        process_name: {
          type: "string",
          description:
            "The PM2 process name to fetch logs for. Defaults to 'portfolio' if not specified.",
        },
        lines: {
          type: "number",
          description: "Number of log lines to fetch. Defaults to 50.",
        },
      },
      required: [],
    },
  },
  {
    name: "trigger_deploy",
    description:
      "Triggers a full deployment for a project: git pull, npm install, npm run build, and pm2 restart. Use this when the user asks to deploy, update, or push changes to the live site.",
    input_schema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description:
            "Absolute path to the project directory. Defaults to /var/www/portfolio.",
        },
        process_name: {
          type: "string",
          description:
            "The PM2 process name to restart after build. Defaults to 'portfolio'.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_disk_usage",
    description:
      "Returns current disk usage and available space on the server. Use this when the user asks about storage, disk space, or server capacity.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_git_status",
    description:
      "Returns the current git status and last 5 commits for a project. Use this when the user asks about recent changes, which branch they're on, or wants to verify the latest code.",
    input_schema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description:
            "Absolute path to the project directory. Defaults to /var/www/portfolio.",
        },
      },
      required: [],
    },
  },
  {
    name: "restart_process",
    description:
      "Restarts a specific PM2 process or restarts nginx. Use this when the user wants to restart a service without doing a full deployment.",
    input_schema: {
      type: "object",
      properties: {
        service: {
          type: "string",
          description:
            "The service to restart. Can be a PM2 process name like 'portfolio' or 'nginx'.",
        },
      },
      required: ["service"],
    },
  },
];

// ─────────────────────────────────────────
//  TOOL HANDLERS
//  These actually run the shell commands
// ─────────────────────────────────────────
async function executeTool(toolName, toolInput) {
  try {
    switch (toolName) {
      case "get_pm2_status": {
        const { stdout } = await execAsync("pm2 jlist");
        const processes = JSON.parse(stdout);
        return processes.map((p) => ({
          name: p.name,
          status: p.pm2_env.status,
          uptime: p.pm2_env.pm_uptime,
          restarts: p.pm2_env.restart_time,
          memory: `${Math.round(p.monit.memory / 1024 / 1024)}MB`,
          cpu: `${p.monit.cpu}%`,
        }));
      }

      case "get_pm2_logs": {
        const name = toolInput.process_name || "portfolio";
        const lines = toolInput.lines || 50;
        const { stdout } = await execAsync(
          `pm2 logs ${name} --lines ${lines} --nostream 2>&1`
        );
        return stdout;
      }

      case "trigger_deploy": {
        const path = toolInput.project_path || "/var/www/portfolio";
        const process = toolInput.process_name || "portfolio";
        const { stdout, stderr } = await execAsync(
          `cd ${path} && git pull origin main && npm install && npm run build && pm2 restart ${process} 2>&1`
        );
        return stdout + stderr;
      }

      case "get_disk_usage": {
        const { stdout } = await execAsync("df -h");
        return stdout;
      }

      case "get_git_status": {
        const path = toolInput.project_path || "/var/www/portfolio";
        const { stdout } = await execAsync(
          `cd ${path} && git status && echo '---COMMITS---' && git log --oneline -5`
        );
        return stdout;
      }

      case "restart_process": {
        const service = toolInput.service;
        if (service === "nginx") {
          const { stdout } = await execAsync(
            "sudo systemctl restart nginx && echo 'nginx restarted successfully'"
          );
          return stdout;
        } else {
          const { stdout } = await execAsync(`pm2 restart ${service}`);
          return stdout;
        }
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (error) {
    return `Error executing ${toolName}: ${error.message}`;
  }
}

// ─────────────────────────────────────────
//  AGENT LOOP
//  Sends message to Claude, handles tool
//  calls in a loop until Claude responds
// ─────────────────────────────────────────
async function runAgent(userMessage) {
  console.log("\n🤖 Thinking...\n");

  const messages = [{ role: "user", content: userMessage }];

  while (true) {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      system: `You are a DevOps assistant managing a Ubuntu VPS server running a Next.js portfolio site.
You have access to tools to check server status, view logs, trigger deployments, and restart services.
The main project is located at /var/www/portfolio and runs as PM2 process named 'portfolio'.
Always be concise and helpful. When something goes wrong, diagnose the root cause clearly.`,
      tools,
      messages,
    });

    // If Claude is done (no more tool calls)
    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock ? textBlock.text : "Done.";
    }

    // Process tool calls
    if (response.stop_reason === "tool_use") {
      const assistantMessage = { role: "assistant", content: response.content };
      messages.push(assistantMessage);

      const toolResults = [];

      for (const block of response.content) {
        if (block.type === "tool_use") {
          console.log(`🔧 Calling tool: ${block.name}`);
          if (Object.keys(block.input).length > 0) {
            console.log(`   Input: ${JSON.stringify(block.input)}`);
          }

          const result = await executeTool(block.name, block.input);
          console.log(`✅ Tool done: ${block.name}\n`);

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }
  }
}

// ─────────────────────────────────────────
//  CLI INTERFACE
//  Simple readline loop to chat with the agent
// ─────────────────────────────────────────
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("╔════════════════════════════════════════╗");
console.log("║       🚀 Dev Assistant MCP Server      ║");
console.log("║   Type your message, or 'exit' to quit ║");
console.log("╚════════════════════════════════════════╝\n");

function prompt() {
  rl.question("You: ", async (input) => {
    const message = input.trim();

    if (!message) {
      prompt();
      return;
    }

    if (message.toLowerCase() === "exit") {
      console.log("Goodbye!");
      rl.close();
      return;
    }

    try {
      const response = await runAgent(message);
      console.log(`\nAssistant: ${response}\n`);
    } catch (error) {
      console.error(`\n❌ Error: ${error.message}\n`);
    }

    prompt();
  });
}

prompt();
