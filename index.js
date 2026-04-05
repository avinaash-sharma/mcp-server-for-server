import Anthropic from "@anthropic-ai/sdk";
import { exec } from "child_process";
import { promisify } from "util";
import * as dotenv from "dotenv";

dotenv.config();

const execAsync = promisify(exec);
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────
//  PROJECTS REGISTRY
//  Add new projects here as you deploy them
// ─────────────────────────────────────────
const PROJECTS = {
  portfolio: {
    path: "/var/www/portfolio",
    process: "portfolio",
    description: "Personal portfolio site at myselfavinash.com",
  },
  // Add new projects below as you deploy them:
  // "creatorcollab": {
  //   path: "/var/www/creatorcollab",
  //   process: "creatorcollab",
  //   description: "CreatorCollab platform"
  // },
};

// ─────────────────────────────────────────
//  SECURITY — Allowed Telegram user IDs
//  Only these users can interact with the bot
// ─────────────────────────────────────────
const ALLOWED_USER_IDS = [
  parseInt(process.env.TELEGRAM_ALLOWED_USER_ID),
];

// ─────────────────────────────────────────
//  TOOL DEFINITIONS
// ─────────────────────────────────────────
const tools = [
  {
    name: "get_pm2_status",
    description:
      "Returns the current status of all PM2 processes. Use when user asks about server status, running processes, uptime, memory, or deployment health.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_pm2_logs",
    description:
      "Fetches recent PM2 logs for a process. Use when user asks about errors, crashes, or wants to debug.",
    input_schema: {
      type: "object",
      properties: {
        process_name: {
          type: "string",
          description: "PM2 process name. Defaults to 'portfolio'.",
        },
        lines: {
          type: "number",
          description: "Number of log lines. Defaults to 50.",
        },
      },
      required: [],
    },
  },
  {
    name: "trigger_deploy",
    description:
      "Triggers a full deployment: git pull, npm install, npm run build, pm2 restart. Use when user asks to deploy, update, or push changes to a project.",
    input_schema: {
      type: "object",
      properties: {
        project_name: {
          type: "string",
          description: `Name of the project to deploy. Available projects: ${Object.keys(PROJECTS).join(", ")}. Defaults to 'portfolio'.`,
        },
      },
      required: [],
    },
  },
  {
    name: "get_disk_usage",
    description:
      "Returns disk usage and available space. Use when user asks about storage or server capacity.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_git_status",
    description:
      "Returns git status and last 5 commits for a project. Use when user asks about recent changes or wants to verify latest code.",
    input_schema: {
      type: "object",
      properties: {
        project_name: {
          type: "string",
          description: `Project name. Available: ${Object.keys(PROJECTS).join(", ")}. Defaults to 'portfolio'.`,
        },
      },
      required: [],
    },
  },
  {
    name: "restart_process",
    description:
      "Restarts a PM2 process or nginx. Use when user wants to restart a service without a full deployment.",
    input_schema: {
      type: "object",
      properties: {
        service: {
          type: "string",
          description: `Service to restart. Can be a PM2 process name (${Object.keys(PROJECTS).join(", ")}) or 'nginx'.`,
        },
      },
      required: ["service"],
    },
  },
  {
    name: "start_process",
    description:
      "Starts a stopped PM2 process. Use when user wants to start an offline service.",
    input_schema: {
      type: "object",
      properties: {
        process_name: {
          type: "string",
          description: "The PM2 process name to start.",
        },
      },
      required: ["process_name"],
    },
  },
  {
    name: "stop_process",
    description:
      "Stops a running PM2 process. Use when user wants to shut down a service.",
    input_schema: {
      type: "object",
      properties: {
        process_name: {
          type: "string",
          description: "The PM2 process name to stop.",
        },
      },
      required: ["process_name"],
    },
  },
  {
    name: "get_memory_usage",
    description:
      "Returns current RAM usage on the server. Use when user asks about memory or server performance.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_projects",
    description:
      "Lists all registered projects with their paths and PM2 process names. Use when user asks what projects are available or deployed.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

// ─────────────────────────────────────────
//  TOOL HANDLERS
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
        const projectName = toolInput.project_name || "portfolio";
        const project = PROJECTS[projectName];
        if (!project) {
          return `Unknown project: ${projectName}. Available: ${Object.keys(PROJECTS).join(", ")}`;
        }
        const { stdout, stderr } = await execAsync(
          `cd ${project.path} && git pull origin main && npm install && npm run build && pm2 restart ${project.process} 2>&1`
        );
        return stdout + stderr;
      }

      case "get_disk_usage": {
        const { stdout } = await execAsync("df -h");
        return stdout;
      }

      case "get_git_status": {
        const projectName = toolInput.project_name || "portfolio";
        const project = PROJECTS[projectName];
        if (!project) {
          return `Unknown project: ${projectName}. Available: ${Object.keys(PROJECTS).join(", ")}`;
        }
        const { stdout } = await execAsync(
          `cd ${project.path} && git status && echo '---COMMITS---' && git log --oneline -5`
        );
        return stdout;
      }

      case "restart_process": {
        const service = toolInput.service;
        const allowedProcesses = [...Object.keys(PROJECTS).map(k => PROJECTS[k].process), "nginx", "mcp-server"];
        if (!allowedProcesses.includes(service)) {
          return `Not allowed. Allowed services: ${allowedProcesses.join(", ")}`;
        }
        if (service === "nginx") {
          const { stdout } = await execAsync("sudo systemctl restart nginx");
          return "nginx restarted successfully";
        }
        const { stdout } = await execAsync(`pm2 restart ${service}`);
        return stdout;
      }

      case "start_process": {
        const allowed = [...Object.values(PROJECTS).map(p => p.process), "mcp-server"];
        if (!allowed.includes(toolInput.process_name)) {
          return `Not allowed. Allowed: ${allowed.join(", ")}`;
        }
        const { stdout } = await execAsync(`pm2 start ${toolInput.process_name}`);
        return stdout;
      }

      case "stop_process": {
        const allowed = [...Object.values(PROJECTS).map(p => p.process), "mcp-server"];
        if (!allowed.includes(toolInput.process_name)) {
          return `Not allowed. Allowed: ${allowed.join(", ")}`;
        }
        const { stdout } = await execAsync(`pm2 stop ${toolInput.process_name}`);
        return stdout;
      }

      case "get_memory_usage": {
        const { stdout } = await execAsync("free -h");
        return stdout;
      }

      case "list_projects": {
        return Object.entries(PROJECTS).map(([name, info]) => ({
          name,
          path: info.path,
          process: info.process,
          description: info.description,
        }));
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
// ─────────────────────────────────────────
async function runAgent(userMessage) {
  const messages = [{ role: "user", content: userMessage }];

  while (true) {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      system: `You are a DevOps assistant managing a Ubuntu VPS server.
Available projects: ${JSON.stringify(PROJECTS, null, 2)}
Always be concise. When something goes wrong, diagnose clearly.
Format responses cleanly — this output goes to Telegram so keep it readable, use short lines.`,
      tools,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock ? textBlock.text : "Done.";
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });

      const toolResults = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          const result = await executeTool(block.name, block.input);
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
//  TELEGRAM BOT
// ─────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

let lastUpdateId = 0;

async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
}

async function getUpdates() {
  const res = await fetch(
    `${TELEGRAM_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`
  );
  const data = await res.json();
  return data.result || [];
}

async function startBot() {
  console.log("🤖 Telegram bot started. Waiting for messages...");

  while (true) {
    try {
      const updates = await getUpdates();

      for (const update of updates) {
        lastUpdateId = update.update_id;

        const message = update.message;
        if (!message || !message.text) continue;

        const userId = message.from.id;
        const chatId = message.chat.id;
        const text = message.text;

        // Security check
        if (!ALLOWED_USER_IDS.includes(userId)) {
          console.log(`Blocked unauthorized user: ${userId}`);
          await sendMessage(chatId, "⛔ Unauthorized.");
          continue;
        }

        console.log(`📩 Message from ${userId}: ${text}`);
        await sendMessage(chatId, "⏳ Working on it...");

        try {
          const response = await runAgent(text);
          // Telegram has a 4096 char limit per message
          if (response.length > 4000) {
            const chunks = response.match(/.{1,4000}/gs);
            for (const chunk of chunks) {
              await sendMessage(chatId, chunk);
            }
          } else {
            await sendMessage(chatId, response);
          }
        } catch (error) {
          await sendMessage(chatId, `❌ Error: ${error.message}`);
        }
      }
    } catch (error) {
      console.error("Polling error:", error.message);
      await new Promise((r) => setTimeout(r, 5000)); // wait 5s before retry
    }
  }
}

startBot();
