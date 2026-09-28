# pi-telegram-notifier

Send the **final** response of each Pi agent run to a paired private Telegram chat. Each notification contains a UTC timestamp, provider, full response text, and the **actual** remaining provider balance when it can be queried. Intermediate tool calls do not trigger messages.

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

Supported balance endpoints (using Pi's resolved credential for the provider/model):

| Provider | Remaining amount |
| --- | --- |
| OpenRouter | Account credits in USD via `/api/v1/credits`. **Requires a management key**; ordinary model API keys get HTTP 403, so the field says `Quota non disponibile`. Per-key spending limits are deliberately not shown as account balance. |
| DeepSeek | Available CNY/USD balances via `/user/balance`. |
| Moonshot AI (global / China) | Available USD / CNY balance via `/v1/users/me/balance`. |

All other providers, custom/proxied endpoints, inaccessible credentials, and failed or malformed lookups show `Quota non disponibile` **without blocking the notification**. Quota percentage is not inferred from context-window usage, token usage, or rate limits. Subscription providers without a documented, usable remaining-quota API cannot display a percentage. See [the 41-provider inventory](docs/providers.md) and official sources for the exact distinction.

Telegram has a message-length limit; long responses are delivered in consecutive plain-text chunks. If delivery fails, Pi reports a generic failure without leaking message or credentials. Network requests have timeouts; Pi remains usable.

## Develop and release

```sh
npm test
npm pack --dry-run --json
pi -e . --help
```

Read [AGENTS.md](AGENTS.md) before editing. Open contributions with tests for behavior changes and official provider documentation for balance integrations. MIT licensed; see [LICENSE](LICENSE). CI runs tests and packaging checks. Publishing is deliberately manual: create the public GitHub repository, then publish the npm package with the `pi-package` keyword to make it eligible for the [Pi package gallery](https://pi.dev/packages). No action here pushes, publishes, or handles real credentials.
