# Solana Wallet Telegram Bot

This bot allows users to create Solana wallets and manage tips through Telegram.

## Features

- Create a new Solana wallet with `/start`
- Send tips to other users with `/tip <username> <amount>`
- Claim received tips with `/claim`

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory and add your Telegram bot token:
```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
```

3. Start the bot:
```bash
node bot.js
```

## Usage

1. Start a chat with the bot and send `/start` to create your own Solana wallet
2. To send a tip to another user, use `/tip <username> <amount>`
3. Users can claim their tips by sending `/claim` to the bot

## Security Notes

- Private keys are stored in memory only and are cleared after claiming
- Make sure to keep your private keys secure and never share them
- The bot should be run in a secure environment

## Requirements

- Node.js
- Telegram Bot Token (get it from @BotFather)
- Internet connection 