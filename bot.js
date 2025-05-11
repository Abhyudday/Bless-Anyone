// Remove dotenv config since we're using hardcoded values
// require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { 
    Keypair, 
    Connection, 
    PublicKey, 
    Transaction, 
    SystemProgram, 
    LAMPORTS_PER_SOL 
} = require('@solana/web3.js');
const { Pool } = require('pg');

// Initialize bot with hardcoded token
const bot = new TelegramBot('7909783368:AAGGmkndrpybLWUtdAvm91MVJG4Oz57vilA', { polling: true });

// Connect to Solana testnet
const connection = new Connection('https://api.testnet.solana.com', 'confirmed');

// Initialize PostgreSQL connection with hardcoded URL
const pool = new Pool({
    connectionString: 'postgresql://postgres:zAGFInFgEecNytNOuHXrxoVcDZyWxaQc@postgres.railway.internal:5432/railway',
    ssl: {
        rejectUnauthorized: false
    }
});

// Initialize maps for in-memory caching
let userWallets = new Map();
let claimWallets = new Map();

// Create tables if they don't exist
async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_wallets (
                user_id TEXT PRIMARY KEY,
                private_key TEXT NOT NULL,
                public_key TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS claim_wallets (
                username TEXT PRIMARY KEY,
                private_key TEXT NOT NULL,
                public_key TEXT NOT NULL,
                from_user_id TEXT,
                amount DECIMAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

// Load wallets from database
async function loadWallets() {
    try {
        // Load user wallets
        const userWalletsResult = await pool.query('SELECT * FROM user_wallets');
        userWalletsResult.rows.forEach(row => {
            userWallets.set(row.user_id, {
                privateKey: row.private_key,
                publicKey: row.public_key
            });
        });

        // Load claim wallets
        const claimWalletsResult = await pool.query('SELECT * FROM claim_wallets');
        claimWalletsResult.rows.forEach(row => {
            claimWallets.set(row.username, {
                privateKey: row.private_key,
                publicKey: row.public_key,
                fromUserId: row.from_user_id,
                amount: parseFloat(row.amount) || 0
            });
        });
        console.log('Wallets loaded successfully from database');
    } catch (error) {
        console.error('Error loading wallets:', error);
    }
}

// Save wallet to database
async function saveWallet(userId, wallet, isClaimWallet = false) {
    try {
        if (isClaimWallet) {
            await pool.query(
                'INSERT INTO claim_wallets (username, private_key, public_key, from_user_id, amount) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO UPDATE SET private_key = $2, public_key = $3, from_user_id = $4, amount = $5',
                [userId, wallet.privateKey, wallet.publicKey, wallet.fromUserId, wallet.amount]
            );
        } else {
            await pool.query(
                'INSERT INTO user_wallets (user_id, private_key, public_key) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET private_key = $2, public_key = $3',
                [userId, wallet.privateKey, wallet.publicKey]
            );
        }
    } catch (error) {
        console.error('Error saving wallet:', error);
    }
}

// Initialize database and load wallets on startup
initializeDatabase().then(() => {
    loadWallets();
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

// Store withdrawal state
const withdrawalState = new Map();

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
            // Store the username in withdrawal state
            withdrawalState.set(userId.toString(), {
                username: username,
                step: 'waiting_for_address'
            });

            const withdrawKeyboard = {
                inline_keyboard: [
                    [{ text: "🔙 Cancel", callback_data: `cancel_withdraw_${username}` }]
                ]
            };

            await bot.sendMessage(chatId, 
                `*Step 1: Enter Destination Wallet Address*\n\n` +
                `Please send the Solana wallet address where you want to withdraw your funds.\n\n` +
                `Example: \`7KqpRwzkkeweW5jQoETyLzhvs9rcCj9dVQ1MnzudirsM\``, {
                parse_mode: 'Markdown',
                reply_markup: withdrawKeyboard
            });
        }
    }
    else if (data.startsWith('cancel_withdraw_')) {
        const username = data.replace('cancel_withdraw_', '');
        withdrawalState.delete(userId.toString());
        
        const claimKeyboard = {
            inline_keyboard: [
                [{ text: "📤 Withdraw Funds", callback_data: `withdraw_claim_${username}` }],
                [{ text: "📊 Check Balance", callback_data: `balance_claim_${username}` }],
                [{ text: "🔑 Show Private Key", callback_data: `show_key_${username}` }]
            ]
        };

        await bot.sendMessage(chatId, "Withdrawal cancelled.", {
            reply_markup: claimKeyboard
        });
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
                
                userWallets.set(userId.toString(), {
                    privateKey,
                    publicKey: wallet.publicKey.toString()
                });
                
                // Save wallets after creating new one
                await saveWallet(userId.toString(), {
                    privateKey,
                    publicKey: wallet.publicKey.toString()
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
                    await bot.sendMessage(chatId, "Failed to get airdrop. Please try again later.");
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
bot.onText(/(?:@TipSolanaBot\s+)?\/tip\s+@?(\w+)\s+(\d+(?:\.\d+)?)/, async (msg, match) => {
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
        await bot.sendMessage(chatId, `❌ @${msg.from.username}, please create a wallet first by messaging @TipSolanaBot /start`, {
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
        // Accumulate the new tip amount
        targetWallet.amount = (targetWallet.amount || 0) + amount;
    } else {
        const newWallet = Keypair.generate();
        targetWallet = {
            privateKey: Buffer.from(newWallet.secretKey).toString('hex'),
            publicKey: newWallet.publicKey.toString(),
            fromUserId: fromUserId.toString(),
            amount: amount
        };
        claimWallets.set(targetUsername, targetWallet);
    }

    try {
        // Save the claim wallet to database
        await saveWallet(targetUsername, targetWallet, true);
        
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
                [{ text: "💳 Create Wallet", url: "https://t.me/TipSolanaBot?start=create" }],
                [{ text: "📝 How to Claim", url: "https://t.me/TipSolanaBot?start=help" }]
            ]
        };

        await bot.sendMessage(chatId, 
            `🎉 *Tip Sent Successfully!*\n\n` +
            `💰 Amount: *${amount} SOL*\n` +
            `👤 From: @${msg.from.username}\n` +
            `🎯 To: @${targetUsername}\n\n` +
            `@${targetUsername}, you've received a tip! 💝\n\n` +
            `To claim your tip:\n` +
            `1️⃣ Message @TipSolanaBot\n` +
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

// Handle withdrawal messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    // Check if user is in withdrawal process
    const withdrawal = withdrawalState.get(userId.toString());
    if (withdrawal) {
        const wallet = claimWallets.get(withdrawal.username);
        if (!wallet) {
            withdrawalState.delete(userId.toString());
            await bot.sendMessage(chatId, "❌ Error: Claim wallet not found.");
            return;
        }

        if (withdrawal.step === 'waiting_for_address') {
            // Validate Solana address
            try {
                new PublicKey(text);
                
                // Store address and move to next step
                withdrawal.destinationAddress = text;
                withdrawal.step = 'waiting_for_amount';
                withdrawalState.set(userId.toString(), withdrawal);

                const withdrawKeyboard = {
                    inline_keyboard: [
                        [{ text: "🔙 Cancel", callback_data: `cancel_withdraw_${withdrawal.username}` }]
                    ]
                };

                await bot.sendMessage(chatId, 
                    `*Step 2: Enter Amount*\n\n` +
                    `Please enter the amount of SOL you want to withdraw.\n\n` +
                    `Available balance: *${await getWalletBalance(wallet.publicKey)} SOL*\n\n` +
                    `Example: \`0.5\``, {
                    parse_mode: 'Markdown',
                    reply_markup: withdrawKeyboard
                });
            } catch (error) {
                await bot.sendMessage(chatId, "❌ Invalid Solana address. Please enter a valid address.");
            }
        }
        else if (withdrawal.step === 'waiting_for_amount') {
            const amount = parseFloat(text);
            if (isNaN(amount) || amount <= 0) {
                await bot.sendMessage(chatId, "❌ Please enter a valid amount greater than 0.");
                return;
            }

            const balance = await getWalletBalance(wallet.publicKey);
            if (balance < amount) {
                await bot.sendMessage(chatId, `❌ Insufficient balance. Your current balance is *${balance} SOL*`, {
                    parse_mode: 'Markdown'
                });
                return;
            }

            try {
                const senderKeypair = createWalletFromPrivateKey(wallet.privateKey);
                const transaction = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: senderKeypair.publicKey,
                        toPubkey: new PublicKey(withdrawal.destinationAddress),
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
                        [{ text: "📤 Withdraw Again", callback_data: `withdraw_claim_${withdrawal.username}` }],
                        [{ text: "📊 Check Balance", callback_data: `balance_claim_${withdrawal.username}` }],
                        [{ text: "🔑 Show Private Key", callback_data: `show_key_${withdrawal.username}` }]
                    ]
                };

                await bot.sendMessage(chatId, 
                    `✅ *Successfully withdrew ${amount} SOL!*\n\n` +
                    `Transaction signature: \`${signature}\``, {
                    parse_mode: 'Markdown',
                    reply_markup: claimKeyboard
                });

                // Clear withdrawal state
                withdrawalState.delete(userId.toString());
            } catch (error) {
                console.error('Withdraw error:', error);
                await bot.sendMessage(chatId, '❌ Failed to withdraw SOL. Please try again.');
            }
        }
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
