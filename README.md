# Dev Assistant MCP Server

A conversational DevOps assistant powered by Claude. Talk to it in plain English to manage your VPS — check status, view logs, trigger deployments, and more.

---

## How It Works

```
You (plain English)
      ↓
  index.js  ──→  Claude API (with tool definitions)
                      ↓
             Claude decides which tool to call
                      ↓
  index.js  ←──  Executes shell command on VPS
                      ↓
             Result sent back to Claude
                      ↓
             Claude responds in natural language
                      ↓
           You see the answer in terminal
```

**Key insight:** Claude never touches your server directly.
Your Node.js app is the middleman — it runs on the VPS and executes commands locally.
Claude just decides *what* to run based on your message.

---

## Concepts You'll Learn

| Concept | What it means |
|---|---|
| **Tool Definition** | Telling Claude what capabilities exist (name + description + input schema) |
| **Tool Calling** | Claude returning `tool_use` blocks instead of text when it needs data |
| **Agent Loop** | Running Claude in a loop until it stops calling tools and gives a final answer |
| **Input Schema** | JSON Schema that defines what parameters a tool accepts |
| **stop_reason** | `"tool_use"` = Claude wants to call a tool, `"end_turn"` = Claude is done |

---

## Project Structure

```
mcp-server/
├── index.js          # Main file — tools + agent loop + CLI
├── package.json
├── .env              # Your API key (never commit this)
├── .env.example      # Template for .env
└── README.md
```

---

## Setup

### 1. Clone / copy to your VPS

```bash
mkdir ~/mcp-server
cd ~/mcp-server
# copy the files here
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create your .env file

```bash
cp .env.example .env
nano .env
```

Add your Anthropic API key:
```
ANTHROPIC_API_KEY=sk-ant-...
```

Get your API key from: https://console.anthropic.com

### 4. Run it

```bash
npm start
```

---

## Example Conversations

```
You: what's the server status?
→ Calls: get_pm2_status
→ Returns: portfolio is online, 55MB memory, 0% CPU

You: why isn't my site updating after deployment?
→ Calls: get_git_status → get_pm2_logs
→ Returns: diagnosis with root cause

You: deploy the portfolio
→ Calls: trigger_deploy
→ Returns: git pull + build + restart output

You: how much disk space is left?
→ Calls: get_disk_usage
→ Returns: formatted df -h output

You: restart nginx
→ Calls: restart_process { service: "nginx" }
→ Returns: confirmation
```

---

## Available Tools

| Tool | What it does | Shell command |
|---|---|---|
| `get_pm2_status` | All PM2 process info | `pm2 jlist` |
| `get_pm2_logs` | Recent logs for a process | `pm2 logs <name> --lines 50` |
| `trigger_deploy` | Full deploy (pull → install → build → restart) | `git pull && npm install && npm run build && pm2 restart` |
| `get_disk_usage` | Disk space info | `df -h` |
| `get_git_status` | Git status + last 5 commits | `git status && git log --oneline -5` |
| `restart_process` | Restart PM2 process or nginx | `pm2 restart <name>` or `systemctl restart nginx` |

---

## Adding a New Tool

It's 3 steps:

**Step 1 — Define it** (add to the `tools` array in index.js):
```javascript
{
  name: "your_tool_name",
  description: "Explain when Claude should use this tool. Be specific.",
  input_schema: {
    type: "object",
    properties: {
      some_param: {
        type: "string",
        description: "What this param is for"
      }
    },
    required: ["some_param"] // or [] if no required params
  }
}
```

**Step 2 — Handle it** (add a case in the `executeTool` switch):
```javascript
case "your_tool_name": {
  const { stdout } = await execAsync("your shell command here");
  return stdout;
}
```

**Step 3 — Test it:**
```bash
npm start
# Then ask something that would trigger your tool
```

The description is the most important part — Claude uses it to decide when to call your tool.

---

## Next Steps (Phase 2)

Once this CLI version is working, the natural next step is adding a Telegram bot interface:

```
Telegram message → Bot → index.js (agent loop) → Response back to Telegram
```

This gives you a mobile-friendly way to manage your server from anywhere — exactly the use case that triggered this project (getting locked out of your VPS 😄).

---

## Important Notes

- **Never commit `.env`** — your API key lives only on the server
- **`trigger_deploy` runs a real deployment** — test carefully
- **The agent loop** keeps calling tools until Claude has enough info to answer — this is normal
- **Claude API costs** — each conversation uses tokens; for personal use it's very cheap (~$0.01 per conversation)
