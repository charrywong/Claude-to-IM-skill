# Install Guide for AI Agents

This document is a source-install guide for AI agents that need to install, build, configure, and operate **both** repositories:

- `Claude-to-IM`
- `Claude-to-IM-skill`

It is written to minimize ambiguity for autonomous setup flows.

## Goal

End state:

- both repositories exist side by side
- the core package is built first
- the skill package is built second
- `~/.claude-to-im/config.env` exists
- the daemon can be started, stopped, restarted, and checked via status/logs

Canonical layout:

```text
~/im-bot/
  Claude-to-IM/
  Claude-to-IM-skill/
```

## Why Two Repos

`Claude-to-IM-skill` depends on the sibling `Claude-to-IM` repository via:

```text
file:../Claude-to-IM
```

Do not clone only the skill repository when doing a source install.

## 1. Clone Both Repositories

```bash
mkdir -p ~/im-bot
cd ~/im-bot

git clone https://github.com/charrywong/Claude-to-IM.git
git clone https://github.com/charrywong/Claude-to-IM-skill.git
```

## 2. Build the Core Repository First

```bash
cd ~/im-bot/Claude-to-IM
npm install
npm run build
```

## 3. Build the Skill Repository Second

```bash
cd ~/im-bot/Claude-to-IM-skill
npm install
npm run build
```

## 4. Install the Skill into Codex

Recommended for local development:

```bash
cd ~/im-bot/Claude-to-IM-skill
bash scripts/install-codex.sh --link
```

This makes `~/.codex/skills/claude-to-im` point to the local checkout, so later code changes only require rebuilds, not reinstallation.

## 5. Create the Runtime Config

Create:

```text
~/.claude-to-im/config.env
```

Minimum Codex + Feishu example:

```env
CTI_RUNTIME=codex
CTI_ENABLED_CHANNELS=feishu
CTI_DEFAULT_WORKDIR=/absolute/path/to/your/project
CTI_DEFAULT_MODE=code

CTI_FEISHU_APP_ID=your_app_id
CTI_FEISHU_APP_SECRET=your_app_secret
CTI_FEISHU_DOMAIN=https://open.feishu.cn
CTI_FEISHU_ALLOWED_USERS=your_user_open_id
```

Notes:

- `CTI_RUNTIME=codex` uses the Codex provider
- `CTI_DEFAULT_WORKDIR` should point to the project the bot should operate in by default
- `CTI_DEFAULT_MODE` is usually `code`
- `CTI_FEISHU_ALLOWED_USERS` is optional but recommended

Then lock down the file:

```bash
chmod 600 ~/.claude-to-im/config.env
```

## 6. Authentication Prerequisites

For Codex runtime:

```bash
codex auth login
```

Alternative API-key-based mode is also possible, but local login is preferred when available.

## 7. Start the Daemon

```bash
bash ~/im-bot/Claude-to-IM-skill/scripts/daemon.sh start
```

## 8. Check Status

```bash
bash ~/im-bot/Claude-to-IM-skill/scripts/daemon.sh status
```

Useful runtime files:

```text
~/.claude-to-im/config.env
~/.claude-to-im/logs/bridge.log
~/.claude-to-im/runtime/status.json
~/.claude-to-im/runtime/bridge.pid
```

## 9. Safe Restart

Use:

```bash
bash ~/im-bot/Claude-to-IM-skill/scripts/daemon-restart-safe.sh
```

Behavior:

- if invoked from inside the bridge process, it writes a restart request file
- if invoked from outside, it performs a safe stop/start cycle

## 10. Rebuild After Code Changes

If code changes in either repository:

```bash
cd ~/im-bot/Claude-to-IM
npm run build

cd ~/im-bot/Claude-to-IM-skill
npm run build
```

Then restart the daemon:

```bash
bash ~/im-bot/Claude-to-IM-skill/scripts/daemon-restart-safe.sh
```

## 11. Update from GitHub

```bash
cd ~/im-bot/Claude-to-IM
git pull
npm install
npm run build

cd ~/im-bot/Claude-to-IM-skill
git pull
npm install
npm run build
```

Then restart:

```bash
bash ~/im-bot/Claude-to-IM-skill/scripts/daemon-restart-safe.sh
```

## 12. Validation Checklist

An installation is considered valid when all of the following are true:

- `~/im-bot/Claude-to-IM` exists
- `~/im-bot/Claude-to-IM-skill` exists
- both `npm run build` commands succeed
- `~/.claude-to-im/config.env` exists
- `daemon.sh status` reports running after start
- `~/.claude-to-im/logs/bridge.log` shows bridge startup without fatal errors
- the IM bot receives and replies to a test message
