# pi-telegram-notifier

Send the **final** response of each Pi agent run to a paired private Telegram chat. Each notification contains a UTC timestamp, provider, full response text, and the **actual** remaining provider balance when it can be queried. Telegram metadata (provider and quota) is in English; the agent's response is forwarded verbatim in its original language. Intermediate tool calls do not trigger messages.

## Install and configure

Requires Node.js 22.19+ and [Pi](https://pi.dev). Create a Telegram bot using [@BotFather](https://t.me/BotFather), then set its token **outside the repository** before starting Pi:

```sh
export PI_TELEGRAM_BOT_TOKEN='your-bot-token'
pi -e .                       # test this checkout as a Pi package
# Later, after public release: pi install npm:pi-telegram-notifier
# Or: pi install git:github.com/Gybra/pi-telegram-notifier
```

In Pi run `/telegram-pair`. Within five minutes send **`/start <code>`** to your bot in a private Telegram chat using the displayed one-time code. The extension stores only the numeric chat ID in `~/.pi/agent/pi-telegram-notifier.json` (or `$PI_CODING_AGENT_DIR/pi-telegram-notifier.json`), with mode 0600. To switch chats, run `/telegram-pair` again; the existing chat stays paired if pairing fails. The bot needs to receive messages via `getUpdates` during pairing: a webhook or another updates consumer must be disconnected first. There is no always-on polling after pairing.

**Privacy:** final agent responses are sent in full to Telegram. They can contain sensitive text; only use this package if that is acceptable for your projects and Telegram chat. Bot and provider tokens are not stored in the package or sent as message text. Telegram Bot API uses the bot token in the request URL; do not log outgoing URLs. Keep your shell environment and Pi credentials private. A lost or compromised Telegram bot token must be revoked with BotFather.

## Quota coverage

The **quota/credit** field supports these Pi provider IDs (using the credential Pi resolves for the active model):

| Pi provider ID | Mode | Required credential | What is shown |
| --- | --- | --- | --- |
| `openai-codex` | Subscription | ChatGPT OAuth | Remaining 5h / 7d usage-window percentages; [official Codex client endpoint](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs). |
| `anthropic` | Subscription | Claude OAuth | Remaining 5h / 7d usage-window percentages; [private OAuth endpoint](https://github.com/openclaw/openclaw/blob/main/src/infra/provider-usage.fetch.claude.ts). |
| `xai` | Subscription | Grok OAuth | Remaining weekly shared Grok credits percentage, **not** prepaid API credit; [official Grok client endpoint](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/extensions/billing.rs). |
| `zai` | Subscription (Coding Plan) | Z.ai Coding Plan key | Remaining 5h **model** quota percentage; [Z.ai usage plugin endpoint](https://github.com/zai-org/zai-coding-plugins/blob/main/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs). Not the separate MCP tool quota. |
| `zai-coding-cn` | Subscription (Coding Plan) | China Coding Plan key | Same model quota on `open.bigmodel.cn`. |
| `openrouter` | API credit | **Management key** | Remaining account credits in USD; ordinary inference keys cannot access the credits endpoint (HTTP 403). Per-key spending limits are not account credit. |
| `deepseek` | API credit | API key | Available CNY/USD balance via `/user/balance`. |
| `moonshotai` | API credit | API key | Available USD balance via `/v1/users/me/balance`. |
| `moonshotai-cn` | API credit | API key | Available CNY balance via `/v1/users/me/balance`. |

**Not supported as API credit:** an `openai` API key does not expose a verified remaining-balance endpoint; an `anthropic` API key does not expose its subscription quota **or** a verified remaining API credit; an `xai` API key does not expose Grok subscription quota or the prepaid API balance (the latter requires a separate management key and team ID); Z.ai pay-as-you-go keys may have no Coding Plan quota. None of the listed providers currently supports both subscription quota **and** API credit through this extension. Usage/cost reports and spending caps are **not** remaining credit.

Pi resolves and refreshes provider credentials, including those saved in its `auth.json`; this extension does **not** read that file. The Codex, Claude, Grok and Z.ai quota endpoints above are not guaranteed stable public APIs. All other providers, custom/proxied endpoints, inaccessible credentials, and failed or malformed lookups show `Quota unavailable` **without blocking the notification**. Quota percentage is not inferred from context-window usage, token usage, or request rate limits. See [the 41-provider inventory](docs/providers.md) for sources and limitations.

Telegram has a message-length limit; long responses are delivered in consecutive plain-text chunks. If delivery fails, Pi reports a generic failure without leaking message or credentials. Network requests have timeouts; Pi remains usable.

## Develop and release

```sh
npm test
npm pack --dry-run --json
pi -e . --help
```

Read [AGENTS.md](AGENTS.md) before editing. Open contributions with tests for behavior changes and official provider documentation for balance integrations. MIT licensed; see [LICENSE](LICENSE). CI runs tests and packaging checks. Publishing is deliberately manual: create the public GitHub repository, then publish the npm package with the `pi-package` keyword to make it eligible for the [Pi package gallery](https://pi.dev/packages). No action here pushes, publishes, or handles real credentials.
