# Bless Anyone - Solana Tip Bot

A Telegram bot that allows users to send and receive SOL tips on the Solana testnet. The bot creates and manages wallets for users, handles tips, and provides a user-friendly interface for managing funds.

## Features

- Create and manage Solana wallets
- Send tips to other users
- Claim received tips
- Check wallet balances
- Deposit and withdraw funds
- Group chat support
- Persistent wallet storage using MongoDB

## Prerequisites

- Node.js (v14 or higher)
- MongoDB Atlas account
- Telegram Bot Token

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
MONGODB_URI=your_mongodb_connection_string
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/Abhyudday/Bless-Anyone.git
cd Bless-Anyone
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
- Copy `.env.example` to `.env`
- Fill in your Telegram bot token and MongoDB URI

4. Start the bot:
```bash
node bot.js
```

## Usage

1. Start a chat with the bot on Telegram
2. Use `/start` to begin
3. Follow the on-screen instructions to:
   - Create a wallet
   - Send tips
   - Claim tips
   - Manage funds

## Commands

- `/start` - Start the bot and create/view wallet
- `/tip @username amount` - Send SOL to another user
- `/claim` - Claim received tips
- `/help` - Show help message
- `/balance` - Check wallet balance
- `/tutorial` - Show tutorial

## Deployment

The bot can be deployed on:
- Render.com (recommended)
- Railway.app
- Any Node.js hosting service

## Security

- Private keys are stored securely in MongoDB
- Environment variables are used for sensitive data
- IP restrictions can be set in MongoDB Atlas

## License

MIT License

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request 