# Solana Tip Bot

A Telegram bot that enables users to send and receive SOL tips on the Solana testnet. The bot creates and manages Solana wallets, handles tips, and includes a 10% fee system for the treasury.

## Features

- Create and manage Solana wallets
- Send tips to other users
- Claim received tips
- Check wallet balances
- 10% fee system for treasury
- Secure private key management
- PostgreSQL database integration

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL database
- Telegram Bot Token
- Solana testnet connection

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd solana-tip-bot
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env` file with the following variables:
```
TELEGRAM_BOT_TOKEN=your_bot_token
DATABASE_URL=your_postgresql_connection_string
```

4. Start the bot:
```bash
node bot.js
```

## Usage

1. Start the bot in Telegram: `/start`
2. Create a wallet using the bot interface
3. Send tips using: `/tip @username amount`
4. Claim tips using: `/claim`
5. Check balance using: `/balance`

## Fee Structure

- 10% of each tip goes to the treasury wallet
- Example: When sending 1 SOL, recipient gets 0.9 SOL
- Treasury wallet: `DB3NZgGPsANwp5RBBMEK2A9ehWeN41QCELRt8WYyL8d8`

## Security

- Private keys are stored securely in the database
- All transactions are performed on Solana testnet
- Users are advised to never share their private keys

## License

MIT License 