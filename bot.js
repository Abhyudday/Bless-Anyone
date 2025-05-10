// Remove dotenv config and add hardcoded variables
// require('dotenv').config();
const TELEGRAM_BOT_TOKEN = '7721938745:AAHGaWGqJlCcHbmiKlapve8cox3gFVVqzyE';
const MONGODB_URI = 'mongodb+srv://singhsunita2772:Abhy@2004@cluster0.3qwp7fg.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0s';

const TelegramBot = require('node-telegram-bot-api');
const { 
    Keypair, 
    Connection, 
    PublicKey, 
    Transaction, 
    SystemProgram, 
    LAMPORTS_PER_SOL 
} = require('@solana/web3.js');
const mongoose = require('mongoose');

// Add error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

console.log('Starting bot initialization...');

// Initialize bot with your token and polling options
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

// Add bot event listeners for debugging
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

bot.on('webhook_error', (error) => {
    console.error('Webhook error:', error);
});

bot.on('error', (error) => {
    console.error('Bot error:', error);
});

console.log('Bot instance created, setting up event handlers...');

// Connect to Solana testnet
const connection = new Connection('https://api.testnet.solana.com', 'confirmed');

// MongoDB Schema
const userWalletSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    privateKey: { type: String, required: true },
    publicKey: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const claimWalletSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    privateKey: { type: String, required: true },
    publicKey: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const UserWallet = mongoose.model('UserWallet', userWalletSchema);
const ClaimWallet = mongoose.model('ClaimWallet', claimWalletSchema);

// Connect to MongoDB with retry logic and better options
const connectWithRetry = async () => {
    const options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        maxPoolSize: 10,
        minPoolSize: 5,
        retryWrites: true,
        retryReads: true
    };

    try {
        console.log('Attempting to connect to MongoDB...');
        await mongoose.connect(MONGODB_URI, options);
        console.log('Successfully connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        console.log('Retrying connection in 5 seconds...');
        setTimeout(connectWithRetry, 5000);
    }
};

// Initial connection attempt
connectWithRetry();

// Handle MongoDB connection events
mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected. Attempting to reconnect...');
    connectWithRetry();
});

mongoose.connection.on('reconnected', () => {
    console.log('MongoDB reconnected successfully');
});

// Add a test command to verify bot is working
bot.onText(/\/test/, async (msg) => {
    const chatId = msg.chat.id;
    console.log('Received /test command from chat:', chatId);
    try {
        await bot.sendMessage(chatId, 'Bot is working! 🎉');
        console.log('Test message sent successfully');
    } catch (error) {
        console.error('Error sending test message:', error);
    }
});

// Function to get wallet balance
async function getWalletBalance(publicKey) {
    try {
        const balance = await connection.getBalance(new PublicKey(publicKey));
        return balance / LAMPORTS_PER_SOL;
    } catch (error) {
        console.error('Error getting balance:', error);
        return 0;
    }
}

// Function to create wallet from private key
function createWalletFromPrivateKey(privateKey) {
    const secretKey = Buffer.from(privateKey, 'hex');
    return Keypair.fromSecretKey(secretKey);
}

// Welcome message with tutorial
const welcomeMessage = `🎉 *Welcome to Solana Tip Bot!* 🎉

This bot helps you send and receive SOL tips on Solana testnet.

Use the buttons below to get started!`;

// Help message
const helpMessage = `*Solana Tip Bot Commands* 📚

/start - Create your funding wallet
/tip @username amount - Send SOL to someone
/claim - Claim your received tips
/help - Show this help message
/balance - Check your wallet balance
/tutorial - Show the tutorial again

*Examples:*
• /tip @john 0.5
• /tip @alice 1.2

*Tips:*
• Always verify the username
• Check your balance before sending
• Keep your private keys safe
• Use testnet SOL only`;

// Handle /start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Send welcome message with buttons
    const keyboard = {
        inline_keyboard: [
            [{ text: "💰 Create/View Wallet", callback_data: "create_wallet" }],
            [{ text: "📝 Tutorial", callback_data: "tutorial" }],
            [{ text: "❓ Help", callback_data: "help" }]
        ]
    };
    
    await bot.sendMessage(chatId, welcomeMessage, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
});

// Handle callback queries
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    // Handle claim wallet actions
    if (data.startsWith('withdraw_claim_')) {
        const username = data.replace('withdraw_claim_', '');
        const wallet = await ClaimWallet.findOne({ username: username });
        if (wallet) {
            const withdrawKeyboard = {
                inline_keyboard: [
                    [{ text: "🔙 Back to Claim", callback_data: `back_to_claim_${username}` }]
                ]
            };
            await bot.sendMessage(chatId, `*Withdraw from your claim wallet:*\n\nPlease send a message in this format:\n\`withdraw_claim ${username} <destination_address> <amount>\`\n\nExample:\n\`withdraw_claim ${username} 7KqpRwzkkeweW5jQoETyLzhvs9rcCj9dVQ1MnzudirsM 0.5\``, {
                parse_mode: 'Markdown',
                reply_markup: withdrawKeyboard
            });
        }
    }
    else if (data.startsWith('balance_claim_')) {
        const username = data.replace('balance_claim_', '');
        const wallet = await ClaimWallet.findOne({ username: username });
        if (wallet) {
            const balance = await getWalletBalance(wallet.publicKey);
            const claimKeyboard = {
                inline_keyboard: [
                    [{ text: "📤 Withdraw", callback_data: `withdraw_claim_${username}` }],
                    [{ text: "🔑 Show Private Key", callback_data: `show_key_${username}` }],
                    [{ text: "🔙 Back to Claim", callback_data: `back_to_claim_${username}` }]
                ]
            };
            await bot.sendMessage(chatId, `*Your Claim Wallet Balance:*\n\n*${balance} SOL*`, {
                parse_mode: 'Markdown',
                reply_markup: claimKeyboard
            });
        }
    }
    else if (data.startsWith('show_key_')) {
        const username = data.replace('show_key_', '');
        const wallet = await ClaimWallet.findOne({ username: username });
        if (wallet) {
            const claimKeyboard = {
                inline_keyboard: [
                    [{ text: "📤 Withdraw", callback_data: `withdraw_claim_${username}` }],
                    [{ text: "📊 Check Balance", callback_data: `balance_claim_${username}` }],
                    [{ text: "🔙 Back to Claim", callback_data: `back_to_claim_${username}` }]
                ]
            };
            await bot.sendMessage(chatId, `*Your Claim Wallet Private Key:*\n\n\`${wallet.privateKey}\`\n\n⚠️ *Keep this private key safe and never share it with anyone!*`, {
                parse_mode: 'Markdown',
                reply_markup: claimKeyboard
            });
        }
    }
    else if (data.startsWith('back_to_claim_')) {
        const username = data.replace('back_to_claim_', '');
        const wallet = await ClaimWallet.findOne({ username: username });
        if (wallet) {
            const balance = await getWalletBalance(wallet.publicKey);
            const claimKeyboard = {
                inline_keyboard: [
                    [{ text: "📤 Withdraw", callback_data: `withdraw_claim_${username}` }],
                    [{ text: "📊 Check Balance", callback_data: `balance_claim_${username}` }],
                    [{ text: "🔑 Show Private Key", callback_data: `show_key_${username}` }]
                ]
            };
            await bot.sendMessage(chatId, `🎉 *Here's your claim wallet information:*\n\nPublic Key: \`${wallet.publicKey}\`\nCurrent Balance: *${balance} SOL*\n\nWhat would you like to do?`, {
                parse_mode: 'Markdown',
                reply_markup: claimKeyboard
            });
        }
    }
    else {
        // Existing callback handlers
        switch (data) {
            case 'tutorial':
                await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
                break;
            
            case 'help':
                await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
                break;
            
            case 'create_wallet':
                try {
                    let existingWallet = await UserWallet.findOne({ userId: userId.toString() });
                    
                    if (existingWallet) {
                        const balance = await getWalletBalance(existingWallet.publicKey);
                        
                        const walletKeyboard = {
                            inline_keyboard: [
                                [{ text: "💳 View Wallet", callback_data: "view_wallet" }],
                                [{ text: "📊 Check Balance", callback_data: "check_balance" }],
                                [{ text: "📥 Deposit", callback_data: "deposit" }],
                                [{ text: "📤 Withdraw", callback_data: "withdraw" }]
                            ]
                        };
                        
                        await bot.sendMessage(chatId, `✅ *Your Wallet Details:*\n\nPublic Key: \`${existingWallet.publicKey}\`\nPrivate Key: \`${existingWallet.privateKey}\`\nCurrent Balance: *${balance} SOL*\n\nKeep your private key safe and never share it with anyone!`, {
                            parse_mode: 'Markdown',
                            reply_markup: walletKeyboard
                        });
                        return;
                    }
                    
                    console.log('Creating new wallet for user:', userId);
                    const wallet = Keypair.generate();
                    const privateKey = Buffer.from(wallet.secretKey).toString('hex');
                    
                    console.log('Generated wallet with public key:', wallet.publicKey.toString());
                    
                    // Save to MongoDB
                    existingWallet = new UserWallet({
                        userId: userId.toString(),
                        privateKey: privateKey,
                        publicKey: wallet.publicKey.toString()
                    });
                    
                    console.log('Attempting to save wallet to MongoDB...');
                    await existingWallet.save();
                    console.log('Wallet saved successfully');
                    
                    try {
                        console.log('Requesting airdrop...');
                        const signature = await connection.requestAirdrop(
                            wallet.publicKey,
                            LAMPORTS_PER_SOL
                        );
                        console.log('Airdrop requested, signature:', signature);
                        
                        console.log('Confirming transaction...');
                        await connection.confirmTransaction(signature);
                        console.log('Transaction confirmed');
                        
                        const walletKeyboard = {
                            inline_keyboard: [
                                [{ text: "💳 View Wallet", callback_data: "view_wallet" }],
                                [{ text: "📊 Check Balance", callback_data: "check_balance" }],
                                [{ text: "📥 Deposit", callback_data: "deposit" }],
                                [{ text: "📤 Withdraw", callback_data: "withdraw" }]
                            ]
                        };
                        
                        await bot.sendMessage(chatId, `🎉 *Your wallet has been created and funded with 1 SOL on testnet!*\n\nPublic Key: \`${wallet.publicKey.toString()}\`\nPrivate Key: \`${privateKey}\`\n\nKeep your private key safe and never share it with anyone!`, {
                            parse_mode: 'Markdown',
                            reply_markup: walletKeyboard
                        });
                    } catch (error) {
                        console.error('Airdrop error:', error);
                        // Still send wallet details even if airdrop fails
                        const walletKeyboard = {
                            inline_keyboard: [
                                [{ text: "💳 View Wallet", callback_data: "view_wallet" }],
                                [{ text: "📊 Check Balance", callback_data: "check_balance" }],
                                [{ text: "📥 Deposit", callback_data: "deposit" }],
                                [{ text: "📤 Withdraw", callback_data: "withdraw" }]
                            ]
                        };
                        
                        await bot.sendMessage(chatId, `🎉 *Your wallet has been created!*\n\nPublic Key: \`${wallet.publicKey.toString()}\`\nPrivate Key: \`${privateKey}\`\n\nNote: Airdrop request failed. You can still deposit SOL to your wallet.`, {
                            parse_mode: 'Markdown',
                            reply_markup: walletKeyboard
                        });
                    }
                } catch (error) {
                    console.error('Detailed error in create_wallet:', error);
                    await bot.sendMessage(chatId, `❌ An error occurred while creating your wallet: ${error.message}\n\nPlease try again later or contact support if the issue persists.`);
                }
                break;
            
            case 'view_wallet':
                const userWallet = await UserWallet.findOne({ userId: userId.toString() });
                if (userWallet) {
                    const balance = await getWalletBalance(userWallet.publicKey);
                    const walletKeyboard = {
                        inline_keyboard: [
                            [{ text: "📥 Deposit", callback_data: "deposit" }],
                            [{ text: "📤 Withdraw", callback_data: "withdraw" }],
                            [{ text: "📊 Check Balance", callback_data: "check_balance" }]
                        ]
                    };
                    await bot.sendMessage(chatId, `*Your Wallet Details:*\n\nPublic Key: \`${userWallet.publicKey}\`\nPrivate Key: \`${userWallet.privateKey}\`\nCurrent Balance: *${balance} SOL*`, {
                        parse_mode: 'Markdown',
                        reply_markup: walletKeyboard
                    });
                }
                break;
            
            case 'check_balance':
                const userWalletForBalance = await UserWallet.findOne({ userId: userId.toString() });
                if (userWalletForBalance) {
                    const balance = await getWalletBalance(userWalletForBalance.publicKey);
                    const balanceKeyboard = {
                        inline_keyboard: [
                            [{ text: "📥 Deposit", callback_data: "deposit" }],
                            [{ text: "📤 Withdraw", callback_data: "withdraw" }],
                            [{ text: "🔙 Back to Wallet", callback_data: "view_wallet" }]
                        ]
                    };
                    await bot.sendMessage(chatId, `*Your Current Balance:*\n\n*${balance} SOL*`, {
                        parse_mode: 'Markdown',
                        reply_markup: balanceKeyboard
                    });
                }
                break;

            case 'deposit':
                const depositWallet = await UserWallet.findOne({ userId: userId.toString() });
                if (depositWallet) {
                    const depositKeyboard = {
                        inline_keyboard: [
                            [{ text: "🔙 Back to Wallet", callback_data: "view_wallet" }]
                        ]
                    };
                    await bot.sendMessage(chatId, `*Deposit SOL to your wallet:*\n\nSend SOL to this address:\n\`${depositWallet.publicKey}\`\n\n*Note:* Make sure to send only SOL on testnet!`, {
                        parse_mode: 'Markdown',
                        reply_markup: depositKeyboard
                    });
                }
                break;

            case 'withdraw':
                const withdrawWallet = await UserWallet.findOne({ userId: userId.toString() });
                if (withdrawWallet) {
                    const withdrawKeyboard = {
                        inline_keyboard: [
                            [{ text: "🔙 Back to Wallet", callback_data: "view_wallet" }]
                        ]
                    };
                    await bot.sendMessage(chatId, `*Withdraw SOL from your wallet:*\n\nPlease send a message in this format:\n\`withdraw <destination_address> <amount>\`\n\nExample:\n\`withdraw 7KqpRwzkkeweW5jQoETyLzhvs9rcCj9dVQ1MnzudirsM 0.5\``, {
                        parse_mode: 'Markdown',
                        reply_markup: withdrawKeyboard
                    });
                }
                break;
        }
    }
    
    // Answer callback query
    await bot.answerCallbackQuery(callbackQuery.id);
});

// Handle tip command in both groups and direct messages
bot.onText(/(?:@TestingBotAbhyudayBot\s+)?\/tip\s+@?(\w+)\s+(\d+(?:\.\d+)?)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const fromUserId = msg.from.id;
    const targetUsername = match[1].toLowerCase();
    const amount = parseFloat(match[2]);

    if (isNaN(amount) || amount <= 0) {
        await bot.sendMessage(chatId, '❌ Please provide a valid amount greater than 0.');
        return;
    }

    // Get sender's wallet
    const senderWallet = await UserWallet.findOne({ userId: fromUserId.toString() });
    if (!senderWallet) {
        const keyboard = {
            inline_keyboard: [
                [{ text: "💳 Create Wallet", callback_data: "create_wallet" }]
            ]
        };
        await bot.sendMessage(chatId, `❌ @${msg.from.username}, please create a wallet first by messaging @TestingBotAbhyudayBot /start`, {
            reply_markup: keyboard
        });
        return;
    }

    // Check sender's balance
    const balance = await getWalletBalance(senderWallet.publicKey);
    if (balance < amount) {
        await bot.sendMessage(chatId, `❌ @${msg.from.username}, insufficient balance. Your current balance is *${balance} SOL*`, {
            parse_mode: 'Markdown'
        });
        return;
    }

    // Create or get claim wallet for the target user
    let targetWallet;
    const existingClaimWallet = await ClaimWallet.findOne({ username: targetUsername });
    if (existingClaimWallet) {
        targetWallet = existingClaimWallet;
    } else {
        const newWallet = Keypair.generate();
        targetWallet = new ClaimWallet({
            username: targetUsername,
            privateKey: Buffer.from(newWallet.secretKey).toString('hex'),
            publicKey: newWallet.publicKey.toString()
        });
        await targetWallet.save();
    }

    try {
        // Create and send transaction
        const senderKeypair = createWalletFromPrivateKey(senderWallet.privateKey);
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: senderKeypair.publicKey,
                toPubkey: new PublicKey(targetWallet.publicKey),
                lamports: amount * LAMPORTS_PER_SOL
            })
        );

        const signature = await connection.sendTransaction(
            transaction,
            [senderKeypair]
        );
        await connection.confirmTransaction(signature);

        // Create a nice message with buttons
        const tipKeyboard = {
            inline_keyboard: [
                [{ text: "💳 Create Wallet", url: "https://t.me/TestingBotAbhyudayBot?start=create" }],
                [{ text: "📝 How to Claim", url: "https://t.me/TestingBotAbhyudayBot?start=help" }]
            ]
        };

        await bot.sendMessage(chatId, 
            `🎉 *Tip Sent Successfully!*\n\n` +
            `💰 Amount: *${amount} SOL*\n` +
            `👤 From: @${msg.from.username}\n` +
            `🎯 To: @${targetUsername}\n\n` +
            `@${targetUsername}, you've received a tip! 💝\n\n` +
            `To claim your tip:\n` +
            `1️⃣ Message @TestingBotAbhyudayBot\n` +
            `2️⃣ Send /claim\n` +
            `3️⃣ Follow the instructions\n\n` +
            `Transaction: \`${signature}\``, {
            parse_mode: 'Markdown',
            reply_markup: tipKeyboard
        });
    } catch (error) {
        console.error('Transfer error:', error);
        await bot.sendMessage(chatId, '❌ Failed to send SOL. Please try again later.');
    }
});

// Handle claim command with improved UI
bot.onText(/\/claim/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username ? msg.from.username.toLowerCase() : null;
    
    if (!username) {
        await bot.sendMessage(chatId, '❌ Please set a username in your Telegram profile to claim your wallet.');
        return;
    }
    
    const wallet = await ClaimWallet.findOne({ username: username });
    
    if (!wallet) {
        await bot.sendMessage(chatId, `❌ No tips found for @${username}. Make sure the username matches exactly (case-insensitive).`);
        return;
    }

    // Check if the wallet has received the funds
    const balance = await getWalletBalance(wallet.publicKey);
    
    const claimKeyboard = {
        inline_keyboard: [
            [{ text: "📤 Withdraw Funds", callback_data: `withdraw_claim_${username}` }],
            [{ text: "📊 Check Balance", callback_data: `balance_claim_${username}` }],
            [{ text: "🔑 Show Private Key", callback_data: `show_key_${username}` }]
        ]
    };
    
    await bot.sendMessage(chatId, 
        `🎉 *You have unclaimed tips!*\n\n` +
        `💰 Available Balance: *${balance} SOL*\n\n` +
        `*What would you like to do?*\n\n` +
        `📤 Withdraw - Send funds to another wallet\n` +
        `📊 Check Balance - View your current balance\n` +
        `🔑 Show Private Key - Get your wallet details`, {
        parse_mode: 'Markdown',
        reply_markup: claimKeyboard
    });
});

// Handle withdraw command
bot.onText(/withdraw (.+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const destinationAddress = match[1];
    const amount = parseFloat(match[2]);

    if (isNaN(amount) || amount <= 0) {
        await bot.sendMessage(chatId, '❌ Please provide a valid amount greater than 0.');
        return;
    }

    const wallet = await UserWallet.findOne({ userId: userId.toString() });
    if (!wallet) {
        const keyboard = {
            inline_keyboard: [
                [{ text: "💳 Create Wallet", callback_data: "create_wallet" }]
            ]
        };
        await bot.sendMessage(chatId, '❌ Please create a wallet first!', {
            reply_markup: keyboard
        });
        return;
    }

    try {
        const balance = await getWalletBalance(wallet.publicKey);
        if (balance < amount) {
            await bot.sendMessage(chatId, `❌ Insufficient balance. Your current balance is *${balance} SOL*`, {
                parse_mode: 'Markdown'
            });
            return;
        }

        const senderKeypair = createWalletFromPrivateKey(wallet.privateKey);
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: senderKeypair.publicKey,
                toPubkey: new PublicKey(destinationAddress),
                lamports: amount * LAMPORTS_PER_SOL
            })
        );

        const signature = await connection.sendTransaction(
            transaction,
            [senderKeypair]
        );
        await connection.confirmTransaction(signature);

        const walletKeyboard = {
            inline_keyboard: [
                [{ text: "💳 View Wallet", callback_data: "view_wallet" }],
                [{ text: "📊 Check Balance", callback_data: "check_balance" }]
            ]
        };

        await bot.sendMessage(chatId, `✅ *Successfully withdrew ${amount} SOL!*\n\nTransaction signature: \`${signature}\``, {
            parse_mode: 'Markdown',
            reply_markup: walletKeyboard
        });
    } catch (error) {
        console.error('Withdraw error:', error);
        await bot.sendMessage(chatId, '❌ Failed to withdraw SOL. Please check the destination address and try again.');
    }
});

// Handle help command
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// Handle tutorial command
bot.onText(/\/tutorial/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

// Handle balance command
bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const wallet = await UserWallet.findOne({ userId: userId.toString() });
    if (!wallet) {
        const keyboard = {
            inline_keyboard: [
                [{ text: "💳 Create Wallet", callback_data: "create_wallet" }]
            ]
        };
        await bot.sendMessage(chatId, '❌ Please create a wallet first!', {
            reply_markup: keyboard
        });
        return;
    }
    
    const balance = await getWalletBalance(wallet.publicKey);
    const balanceKeyboard = {
        inline_keyboard: [
            [{ text: "📥 Deposit", callback_data: "deposit" }],
            [{ text: "📤 Withdraw", callback_data: "withdraw" }],
            [{ text: "🔙 Back to Wallet", callback_data: "view_wallet" }]
        ]
    };
    await bot.sendMessage(chatId, `*Your Current Balance:*\n\n*${balance} SOL*`, {
        parse_mode: 'Markdown',
        reply_markup: balanceKeyboard
    });
});

// Handle withdraw_claim command
bot.onText(/withdraw_claim (.+) (.+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const username = match[1];
    const destinationAddress = match[2];
    const amount = parseFloat(match[3]);

    if (isNaN(amount) || amount <= 0) {
        await bot.sendMessage(chatId, '❌ Please provide a valid amount greater than 0.');
        return;
    }

    const wallet = await ClaimWallet.findOne({ username: username });
    if (!wallet) {
        await bot.sendMessage(chatId, '❌ Claim wallet not found.');
        return;
    }

    try {
        const balance = await getWalletBalance(wallet.publicKey);
        if (balance < amount) {
            await bot.sendMessage(chatId, `❌ Insufficient balance. Your current balance is *${balance} SOL*`, {
                parse_mode: 'Markdown'
            });
            return;
        }

        const senderKeypair = createWalletFromPrivateKey(wallet.privateKey);
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: senderKeypair.publicKey,
                toPubkey: new PublicKey(destinationAddress),
                lamports: amount * LAMPORTS_PER_SOL
            })
        );

        const signature = await connection.sendTransaction(
            transaction,
            [senderKeypair]
        );
        await connection.confirmTransaction(signature);

        const claimKeyboard = {
            inline_keyboard: [
                [{ text: "📤 Withdraw", callback_data: `withdraw_claim_${username}` }],
                [{ text: "📊 Check Balance", callback_data: `balance_claim_${username}` }],
                [{ text: "🔑 Show Private Key", callback_data: `show_key_${username}` }]
            ]
        };

        await bot.sendMessage(chatId, `✅ *Successfully withdrew ${amount} SOL from your claim wallet!*\n\nTransaction signature: \`${signature}\``, {
            parse_mode: 'Markdown',
            reply_markup: claimKeyboard
        });
    } catch (error) {
        console.error('Withdraw error:', error);
        await bot.sendMessage(chatId, '❌ Failed to withdraw SOL. Please check the destination address and try again.');
    }
});

// Add startup confirmation
console.log('Bot setup complete. Ready to receive messages!');

// Export bot instance for potential testing
module.exports = bot; 