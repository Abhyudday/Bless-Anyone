require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { 
    Keypair, 
    Connection, 
    PublicKey, 
    Transaction, 
    SystemProgram, 
    LAMPORTS_PER_SOL 
} = require('@solana/web3.js');
const { MongoClient } = require('mongodb');

// Initialize bot with your token
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Connect to Solana testnet
const connection = new Connection('https://api.testnet.solana.com', 'confirmed');

// MongoDB connection
const MONGODB_URI = 'mongodb+srv://singhsunita2772:Abhy%402004@cluster0.3qwp7fg.mongodb.net/solana_tip_bot?retryWrites=true&w=majority';
const client = new MongoClient(MONGODB_URI, {
    ssl: true,
    tls: true,
    tlsInsecure: true,
    directConnection: true,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    family: 4,
    maxPoolSize: 10,
    minPoolSize: 5,
    maxIdleTimeMS: 30000,
    retryWrites: true,
    w: 'majority'
});
let db;
let isConnecting = false;
let connectionRetries = 0;
const MAX_RETRIES = 5;

// Initialize Maps for storing wallets
let userWallets = new Map();
let claimWallets = new Map();

// Initialize MongoDB connection
async function initializeMongoDB() {
    if (isConnecting) {
        console.log('MongoDB connection already in progress...');
        return;
    }

    if (connectionRetries >= MAX_RETRIES) {
        console.error('Max MongoDB connection retries reached');
        return;
    }

    isConnecting = true;
    connectionRetries++;

    try {
        await client.connect();
        console.log('Connected to MongoDB successfully');
        db = client.db('solana_tip_bot');
        connectionRetries = 0; // Reset retry counter on successful connection
        
        // Load existing wallets from MongoDB
        await loadWalletsFromMongoDB();
    } catch (error) {
        console.error('MongoDB connection error:', error);
        isConnecting = false;
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
        return initializeMongoDB();
    } finally {
        isConnecting = false;
    }
}

// Load wallets from MongoDB
async function loadWalletsFromMongoDB() {
    try {
        // Load user wallets
        const userWalletsCollection = db.collection('user_wallets');
        const userWalletsData = await userWalletsCollection.find({}).toArray();
        userWalletsData.forEach(wallet => {
            userWallets.set(wallet.userId, {
                publicKey: wallet.publicKey,
                privateKey: wallet.privateKey
            });
        });
        console.log(`Loaded ${userWalletsData.length} user wallets from MongoDB`);

        // Load claim wallets
        const claimWalletsCollection = db.collection('claim_wallets');
        const claimWalletsData = await claimWalletsCollection.find({}).toArray();
        claimWalletsData.forEach(wallet => {
            claimWallets.set(wallet.username, {
                publicKey: wallet.publicKey,
                privateKey: wallet.privateKey,
                fromUserId: wallet.fromUserId,
                amount: wallet.amount
            });
        });
        console.log(`Loaded ${claimWalletsData.length} claim wallets from MongoDB`);
    } catch (error) {
        console.error('Error loading wallets from MongoDB:', error);
    }
}

// Initialize MongoDB on startup
initializeMongoDB().catch(console.error);

// Add error handling for MongoDB operations
async function safeMongoOperation(operation) {
    if (!db) {
        try {
            await initializeMongoDB();
            if (!db) {
                console.error('Failed to initialize MongoDB after retry');
                return null;
            }
        } catch (error) {
            console.error('Failed to initialize MongoDB:', error);
            return null;
        }
    }

    try {
        return await operation();
    } catch (error) {
        if (error.name === 'MongoServerSelectionError' || error.name === 'MongoNetworkError') {
            console.error('MongoDB connection error during operation:', error);
            // Try to reconnect
            await initializeMongoDB();
            if (db) {
                return await operation();
            }
        }
        throw error;
    }
}

// Update the saveWallets function to use safeMongoOperation
async function saveWallets() {
    return safeMongoOperation(async () => {
        if (!db) {
            console.error('Database not initialized');
            return;
        }
        
        try {
            const userWalletsCollection = db.collection('user_wallets');
            const claimWalletsCollection = db.collection('claim_wallets');

            // Convert Maps to arrays of documents
            const userWalletsArray = Array.from(userWallets.entries()).map(([userId, wallet]) => ({
                userId,
                ...wallet
            }));

            const claimWalletsArray = Array.from(claimWallets.entries()).map(([username, wallet]) => ({
                username,
                ...wallet
            }));

            // Clear existing data
            await userWalletsCollection.deleteMany({});
            await claimWalletsCollection.deleteMany({});

            // Insert new data
            if (userWalletsArray.length > 0) {
                await userWalletsCollection.insertMany(userWalletsArray);
            }
            if (claimWalletsArray.length > 0) {
                await claimWalletsCollection.insertMany(claimWalletsArray);
            }

            console.log('Wallets saved to MongoDB successfully');
        } catch (error) {
            console.error('Error saving wallets to MongoDB:', error);
            throw error;
        }
    });
}

// Save wallets periodically (every 5 minutes)
setInterval(saveWallets, 5 * 60 * 1000);

// Save wallets before process exit
process.on('SIGINT', async () => {
    await saveWallets();
    await client.close();
    process.exit();
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
        const wallet = claimWallets.get(username);
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
        const wallet = claimWallets.get(username);
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
        const wallet = claimWallets.get(username);
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
        const wallet = claimWallets.get(username);
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
                if (userWallets.has(userId.toString())) {
                    const existingWallet = userWallets.get(userId.toString());
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
                
                const wallet = Keypair.generate();
                const privateKey = Buffer.from(wallet.secretKey).toString('hex');
                
                const newWallet = {
                    privateKey,
                    publicKey: wallet.publicKey.toString()
                };
                
                userWallets.set(userId.toString(), newWallet);
                
                // Save to MongoDB immediately using safeMongoOperation
                await safeMongoOperation(async () => {
                    try {
                        await db.collection('user_wallets').insertOne({
                            userId: userId.toString(),
                            ...newWallet
                        });
                        console.log('New wallet saved to MongoDB');
                    } catch (error) {
                        console.error('Error saving new wallet to MongoDB:', error);
                    }
                });
                
                try {
                    const signature = await connection.requestAirdrop(
                        wallet.publicKey,
                        LAMPORTS_PER_SOL
                    );
                    await connection.confirmTransaction(signature);
                    
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
                    await bot.sendMessage(chatId, "Failed to get airdrop. Please try again later or visit https://faucet.solana.com to get test SOL.");
                }
                break;
            
            case 'view_wallet':
                const userWallet = userWallets.get(userId.toString());
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
                const userWalletForBalance = userWallets.get(userId.toString());
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
                const depositWallet = userWallets.get(userId.toString());
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
                const withdrawWallet = userWallets.get(userId.toString());
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
    const senderWallet = userWallets.get(fromUserId.toString());
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
    if (claimWallets.has(targetUsername)) {
        targetWallet = claimWallets.get(targetUsername);
    } else {
        const newWallet = Keypair.generate();
        targetWallet = {
            privateKey: Buffer.from(newWallet.secretKey).toString('hex'),
            publicKey: newWallet.publicKey.toString(),
            fromUserId: fromUserId.toString(),
            amount: amount
        };
        claimWallets.set(targetUsername, targetWallet);
        
        // Save new claim wallet to MongoDB using safeMongoOperation
        await safeMongoOperation(async () => {
            try {
                await db.collection('claim_wallets').insertOne({
                    username: targetUsername,
                    ...targetWallet
                });
                console.log('New claim wallet saved to MongoDB');
            } catch (error) {
                console.error('Error saving new claim wallet to MongoDB:', error);
            }
        });
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
    
    const wallet = claimWallets.get(username);
    
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

    const wallet = userWallets.get(userId.toString());
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
    
    const wallet = userWallets.get(userId.toString());
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

    const wallet = claimWallets.get(username);
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

// Error handling
bot.on('polling_error', (error) => {
    console.log(error);
}); 