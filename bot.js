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

// Connect to Solana mainnet
const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

// Initialize PostgreSQL connection with hardcoded URL
const pool = new Pool({
    connectionString: 'postgresql://postgres:zAGFInFgEecNytNOuHXrxoVcDZyWxaQc@postgres.railway.internal:5432/railway',
    ssl: {
        rejectUnauthorized: false
    }
});

// Initialize maps for in-memory caching
let userWallets = new Map();

// Add fees wallet address constant at the top with other constants
const FEES_WALLET = 'DB3NZgGPsANwp5RBBMEK2A9ehWeN41QCELRt8WYyL8d8';
const FEE_PERCENTAGE = 0.10; // 10% fee per transaction

// Add network state tracking
let userNetworks = new Map(); // Store user's preferred network

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
        console.log('Wallets loaded successfully from database');
    } catch (error) {
        console.error('Error loading wallets:', error);
    }
}

// Save wallet to database
async function saveWallet(userId, wallet) {
    try {
        await pool.query(
            'INSERT INTO user_wallets (user_id, private_key, public_key) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET private_key = $2, public_key = $3',
            [userId, wallet.privateKey, wallet.publicKey]
        );
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

This bot helps you send and receive SOL tips on Solana.

*Network:* Mainnet (default)
*Fee Structure:*
• Transaction Fee: 10% of tip amount
• Network Fee: ~0.000005 SOL per transaction

Use the buttons below to get started!`;

// Help message
const helpMessage = `*Solana Tip Bot Commands* 📚

/start - Create your wallet
/tip @username amount - Send SOL to someone
/balance - Check your wallet balance
/network - Switch between Mainnet and Testnet
/tutorial - Show the tutorial again

*Examples:*
• /tip @john 0.5
• /tip @alice 1.2

*Fee Structure:*
• Transaction Fee: 10% of tip amount
• Network Fee: ~0.000005 SOL per transaction

*Tips:*
• Always verify the username
• Check your balance before sending
• Keep your private keys safe
• Ensure you have enough SOL for tip + fees`;

// Add helper function for transaction links
function getTransactionLink(signature) {
    return `https://solscan.io/tx/${signature}`;
}

// Handle /start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Send welcome message with buttons
    const keyboard = {
        inline_keyboard: [
            [{ text: "💰 Create/View Wallet", callback_data: "create_wallet" }],
            [{ text: "🔄 Switch to Testnet", callback_data: "switch_network" }],
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
        const wallet = userWallets.get(username);
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
        const wallet = userWallets.get(username);
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
        const wallet = userWallets.get(username);
        if (wallet) {
            const claimKeyboard = {
                inline_keyboard: [
                    [{ text: "📤 Withdraw", callback_data: `withdraw_claim_${username}` }],
                    [{ text: "📊 Check Balance", callback_data: `balance_claim_${username}` }],
                    [{ text: "🔙 Back to Claim", callback_data: `back_to_claim_${username}` }]
                ]
            };
            await bot.sendMessage(chatId, 
                `*Your Claim Wallet Private Key:*\n\n` +
                `||${wallet.privateKey}||\n\n` +
                `⚠️ *Keep this private key safe and never share it with anyone!*\n\n` +
                `*Click on the blurred text above to reveal your private key.*`, {
                parse_mode: 'Markdown',
                reply_markup: claimKeyboard
            });
        }
    }
    else if (data.startsWith('back_to_claim_')) {
        const username = data.replace('back_to_claim_', '');
        const wallet = userWallets.get(username);
        if (wallet) {
            const balance = await getWalletBalance(wallet.publicKey);
            const claimKeyboard = {
                inline_keyboard: [
                    [{ text: "📤 Withdraw", callback_data: `withdraw_claim_${username}` }],
                    [{ text: "📊 Check Balance", callback_data: `balance_claim_${username}` }],
                    [{ text: "🔑 Show Private Key", callback_data: `show_key_${username}` }]
                ]
            };
            await bot.sendMessage(chatId, 
                `🎉 *Here's your claim wallet information:*\n\n` +
                `Public Key: \`${wallet.publicKey}\`\n\n` +
                `Current Balance: *${balance} SOL*\n\n` +
                `*What would you like to do?*`, {
                parse_mode: 'Markdown',
                reply_markup: claimKeyboard
            });
        }
    }
    else {
        // Existing callback handlers
        switch (data) {
            case 'switch_network':
                const currentNetwork = userNetworks.get(userId.toString()) || 'mainnet';
                const newNetwork = currentNetwork === 'mainnet' ? 'testnet' : 'mainnet';
                
                // Update user's network preference
                userNetworks.set(userId.toString(), newNetwork);
                
                // Update connection based on network
                const connection = new Connection(
                    newNetwork === 'mainnet' 
                        ? 'https://api.mainnet-beta.solana.com'
                        : 'https://api.testnet.solana.com',
                    'confirmed'
                );
                
                const networkKeyboard = {
                    inline_keyboard: [
                        [{ text: "💰 Create/View Wallet", callback_data: "create_wallet" }],
                        [{ text: newNetwork === 'mainnet' ? "🔄 Switch to Testnet" : "🔄 Switch to Mainnet", callback_data: "switch_network" }],
                        [{ text: "❓ Help", callback_data: "help" }]
                    ]
                };
                
                await bot.sendMessage(chatId, 
                    `🔄 *Network Switched Successfully!*\n\n` +
                    `Current Network: *${newNetwork.toUpperCase()}*\n\n` +
                    `*Fee Structure:*\n` +
                    `• Transaction Fee: *0.01 SOL* per tip\n` +
                    `• Network Fee: *~0.000005 SOL* per transaction\n\n` +
                    `*Note:* Make sure you have enough SOL to cover both the tip amount and fees.`, {
                    parse_mode: 'Markdown',
                    reply_markup: networkKeyboard
                });
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
                            [{ text: "🔑 Show Private Key", callback_data: "show_private_key" }],
                            [{ text: "💳 View Wallet", callback_data: "view_wallet" }],
                            [{ text: "📊 Check Balance", callback_data: "check_balance" }],
                            [{ text: "📥 Deposit", callback_data: "deposit" }],
                            [{ text: "📤 Withdraw", callback_data: "withdraw" }]
                        ]
                    };
                    
                    await bot.sendMessage(chatId, 
                        `✅ *Your Wallet Details:*\n\n` +
                        `Public Key: \`${existingWallet.publicKey}\`\n\n` +
                        `Current Balance: *${balance} SOL*\n\n` +
                        `*Click the button below to view your private key.*`, {
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
                            [{ text: "🔑 Show Private Key", callback_data: "show_private_key" }],
                            [{ text: "💳 View Wallet", callback_data: "view_wallet" }],
                            [{ text: "📊 Check Balance", callback_data: "check_balance" }],
                            [{ text: "📥 Deposit", callback_data: "deposit" }],
                            [{ text: "📤 Withdraw", callback_data: "withdraw" }]
                        ]
                    };
                    
                    await bot.sendMessage(chatId, 
                        `🎉 *Your wallet has been created!*\n\n` +
                        `Public Key: \`${wallet.publicKey.toString()}\`\n\n` +
                        `*Click the button below to view your private key.*`, {
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
                            [{ text: "🔑 Show Private Key", callback_data: "show_private_key" }],
                            [{ text: "📊 Check Balance", callback_data: "check_balance" }],
                            [{ text: "📥 Deposit", callback_data: "deposit" }],
                            [{ text: "📤 Withdraw", callback_data: "withdraw" }]
                        ]
                    };
                    await bot.sendMessage(chatId, 
                        `*Your Wallet Details:*\n\n` +
                        `Public Key: \`${userWallet.publicKey}\`\n\n` +
                        `Current Balance: *${balance} SOL*\n\n` +
                        `*Click the button below to view your private key.*`, {
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
                            [{ text: "🔑 Show Private Key", callback_data: "show_private_key" }],
                            [{ text: "💳 View Wallet", callback_data: "view_wallet" }],
                            [{ text: "📥 Deposit", callback_data: "deposit" }],
                            [{ text: "📤 Withdraw", callback_data: "withdraw" }]
                        ]
                    };
                    await bot.sendMessage(chatId, 
                        `*Your Current Balance:*\n\n` +
                        `*${balance} SOL*`, {
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
                            [{ text: "🔑 Show Private Key", callback_data: "show_private_key" }],
                            [{ text: "💳 View Wallet", callback_data: "view_wallet" }],
                            [{ text: "📊 Check Balance", callback_data: "check_balance" }]
                        ]
                    };
                    await bot.sendMessage(chatId, 
                        `*Deposit SOL to your wallet:*\n\n` +
                        `Send SOL to this address:\n` +
                        `\`${depositWallet.publicKey}\`\n\n` +
                        `*Note:* Make sure to send only SOL!`, {
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
                            [{ text: "🔑 Show Private Key", callback_data: "show_private_key" }],
                            [{ text: "💳 View Wallet", callback_data: "view_wallet" }],
                            [{ text: "📊 Check Balance", callback_data: "check_balance" }]
                        ]
                    };
                    await bot.sendMessage(chatId, 
                        `*Withdraw SOL from your wallet:*\n\n` +
                        `Please send a message in this format:\n` +
                        `\`withdraw <destination_address> <amount>\`\n\n` +
                        `Example:\n` +
                        `\`withdraw 7KqpRwzkkeweW5jQoETyLzhvs9rcCj9dVQ1MnzudirsM 0.5\``, {
                        parse_mode: 'Markdown',
                        reply_markup: withdrawKeyboard
                    });
                }
                break;

            case 'show_private_key':
                const userWalletForPrivateKey = userWallets.get(userId.toString());
                if (userWalletForPrivateKey) {
                    const balance = await getWalletBalance(userWalletForPrivateKey.publicKey);
                    const walletKeyboard = {
                        inline_keyboard: [
                            [{ text: "💳 View Wallet", callback_data: "view_wallet" }],
                            [{ text: "📊 Check Balance", callback_data: "check_balance" }],
                            [{ text: "📥 Deposit", callback_data: "deposit" }],
                            [{ text: "📤 Withdraw", callback_data: "withdraw" }]
                        ]
                    };
                    await bot.sendMessage(chatId, 
                        `*Your Private Key:*\n\n` +
                        `\`${userWalletForPrivateKey.privateKey}\`\n\n` +
                        `⚠️ *Keep this private key safe and never share it with anyone!*`, {
                        parse_mode: 'Markdown',
                        reply_markup: walletKeyboard
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

    // Calculate fee amount (10% of the tip amount)
    const feeAmount = amount * FEE_PERCENTAGE;
    const totalAmount = amount + feeAmount;

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
    if (balance < totalAmount) {
        await bot.sendMessage(chatId, `❌ @${msg.from.username}, insufficient balance. Your current balance is *${balance} SOL*\n\nRequired amount: *${totalAmount} SOL* (${amount} SOL tip + ${feeAmount} SOL fee)`, {
            parse_mode: 'Markdown'
        });
        return;
    }

    // Get or create target user's wallet
    let targetWallet = userWallets.get(targetUsername);
    if (!targetWallet) {
        const newWallet = Keypair.generate();
        targetWallet = {
            privateKey: Buffer.from(newWallet.secretKey).toString('hex'),
            publicKey: newWallet.publicKey.toString()
        };
        userWallets.set(targetUsername, targetWallet);
        await saveWallet(targetUsername, targetWallet);
    }

    try {
        // Send processing message
        const processingMsg = await bot.sendMessage(chatId, 
            `⏳ *Processing Tip*\n\n` +
            `💰 Amount: *${amount} SOL*\n` +
            `💸 Fee: *${feeAmount} SOL* (10%)\n` +
            `👤 To: @${targetUsername}\n\n` +
            `Please wait while we process your transaction...`, {
            parse_mode: 'Markdown'
        });

        // Create and send transaction
        const senderKeypair = createWalletFromPrivateKey(senderWallet.privateKey);
        
        // Create a transaction that includes both the tip and fee transfer
        const transaction = new Transaction();
        
        // Add tip transfer
        transaction.add(
            SystemProgram.transfer({
                fromPubkey: senderKeypair.publicKey,
                toPubkey: new PublicKey(targetWallet.publicKey),
                lamports: amount * LAMPORTS_PER_SOL
            })
        );
        
        // Add fee transfer
        transaction.add(
            SystemProgram.transfer({
                fromPubkey: senderKeypair.publicKey,
                toPubkey: new PublicKey(FEES_WALLET),
                lamports: feeAmount * LAMPORTS_PER_SOL
            })
        );

        // Get recent blockhash
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = senderKeypair.publicKey;

        // Sign and send transaction
        const signature = await connection.sendTransaction(
            transaction,
            [senderKeypair]
        );
        
        // Wait for confirmation with timeout
        const confirmation = await Promise.race([
            connection.confirmTransaction(signature),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Transaction confirmation timeout')), 30000)
            )
        ]);

        if (confirmation.value?.err) {
            throw new Error('Transaction failed to confirm');
        }

        // Delete processing message
        await bot.deleteMessage(chatId, processingMsg.message_id);

        // Create a nice message with buttons
        const tipKeyboard = {
            inline_keyboard: [
                [{ text: "💳 Create Wallet", url: "https://t.me/TipSolanaBot?start=create" }],
                [{ text: "🔍 View Transaction", url: getTransactionLink(signature) }]
            ]
        };

        await bot.sendMessage(chatId, 
            `🎉 *Tip Sent Successfully!*\n\n` +
            `💰 Amount: *${amount} SOL*\n` +
            `💸 Transaction Fee: *${feeAmount} SOL* (10%)\n` +
            `🌐 Network Fee: *~0.000005 SOL*\n` +
            `👤 From: @${msg.from.username}\n` +
            `🎯 To: @${targetUsername}\n\n` +
            `@${targetUsername}, you've received a tip! 💝\n\n` +
            `Your balance has been updated automatically.\n` +
            `Use /balance to check your new balance.\n\n` +
            `Transaction: \`${signature}\`\n` +
            `[View on Solscan](${getTransactionLink(signature)})`, {
            parse_mode: 'Markdown',
            reply_markup: tipKeyboard
        });
    } catch (error) {
        console.error('Transfer error:', error);
        // Check if the transaction was actually successful despite the error
        try {
            const status = await connection.getSignatureStatus(signature);
            if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
                // Transaction was successful, send success message
                const tipKeyboard = {
                    inline_keyboard: [
                        [{ text: "💳 Create Wallet", url: "https://t.me/TipSolanaBot?start=create" }],
                        [{ text: "🔍 View Transaction", url: getTransactionLink(signature) }]
                    ]
                };

                await bot.sendMessage(chatId, 
                    `🎉 *Tip Sent Successfully!*\n\n` +
                    `💰 Amount: *${amount} SOL*\n` +
                    `💸 Transaction Fee: *${feeAmount} SOL* (10%)\n` +
                    `🌐 Network Fee: *~0.000005 SOL*\n` +
                    `👤 From: @${msg.from.username}\n` +
                    `🎯 To: @${targetUsername}\n\n` +
                    `@${targetUsername}, you've received a tip! 💝\n\n` +
                    `Your balance has been updated automatically.\n` +
                    `Use /balance to check your new balance.\n\n` +
                    `Transaction: \`${signature}\`\n` +
                    `[View on Solscan](${getTransactionLink(signature)})`, {
                    parse_mode: 'Markdown',
                    reply_markup: tipKeyboard
                });
                return;
            }
        } catch (statusError) {
            console.error('Error checking transaction status:', statusError);
        }
        
        await bot.sendMessage(chatId, '❌ Failed to send SOL. Please try again later.');
    }
});

// Handle withdrawal messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    // Check if user is in withdrawal process
    const withdrawal = withdrawalState.get(userId.toString());
    if (withdrawal) {
        const wallet = userWallets.get(withdrawal.username);
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
                // Send processing message
                const processingMsg = await bot.sendMessage(chatId, 
                    `⏳ *Processing Withdrawal*\n\n` +
                    `💰 Amount: *${amount} SOL*\n` +
                    `👤 To: \`${withdrawal.destinationAddress}\`\n\n` +
                    `Please wait while we process your transaction...`, {
                    parse_mode: 'Markdown'
                });

                const senderKeypair = createWalletFromPrivateKey(wallet.privateKey);
                const transaction = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: senderKeypair.publicKey,
                        toPubkey: new PublicKey(withdrawal.destinationAddress),
                        lamports: amount * LAMPORTS_PER_SOL
                    })
                );

                // Get recent blockhash
                const { blockhash } = await connection.getLatestBlockhash();
                transaction.recentBlockhash = blockhash;
                transaction.feePayer = senderKeypair.publicKey;

                const signature = await connection.sendTransaction(
                    transaction,
                    [senderKeypair]
                );

                // Wait for confirmation with timeout
                const confirmation = await Promise.race([
                    connection.confirmTransaction(signature),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Transaction confirmation timeout')), 30000)
                    )
                ]);

                if (confirmation.value?.err) {
                    throw new Error('Transaction failed to confirm');
                }

                // Delete processing message
                await bot.deleteMessage(chatId, processingMsg.message_id);

                const claimKeyboard = {
                    inline_keyboard: [
                        [{ text: "📤 Withdraw Again", callback_data: `withdraw_claim_${withdrawal.username}` }],
                        [{ text: "🔍 View Transaction", url: getTransactionLink(signature) }]
                    ]
                };

                await bot.sendMessage(chatId, 
                    `🎉 *Withdrawal Successful!*\n\n` +
                    `💰 Amount: *${amount} SOL*\n` +
                    `👤 From: @${msg.from.username}\n` +
                    `🎯 To: \`${withdrawal.destinationAddress}\`\n\n` +
                    `Transaction: \`${signature}\`\n` +
                    `[View on Solscan](${getTransactionLink(signature)})`, {
                    parse_mode: 'Markdown',
                    reply_markup: claimKeyboard
                });

                // Clear withdrawal state
                withdrawalState.delete(userId.toString());
            } catch (error) {
                console.error('Withdrawal error:', error);
                
                // Check if the transaction was actually successful despite the error
                try {
                    const status = await connection.getSignatureStatus(signature);
                    if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
                        // Transaction was successful, send success message
                        const claimKeyboard = {
                            inline_keyboard: [
                                [{ text: "📤 Withdraw Again", callback_data: `withdraw_claim_${withdrawal.username}` }],
                                [{ text: "🔍 View Transaction", url: getTransactionLink(signature) }]
                            ]
                        };

                        await bot.sendMessage(chatId, 
                            `🎉 *Withdrawal Successful!*\n\n` +
                            `💰 Amount: *${amount} SOL*\n` +
                            `👤 From: @${msg.from.username}\n` +
                            `🎯 To: \`${withdrawal.destinationAddress}\`\n\n` +
                            `Transaction: \`${signature}\`\n` +
                            `[View on Solscan](${getTransactionLink(signature)})`, {
                            parse_mode: 'Markdown',
                            reply_markup: claimKeyboard
                        });
                        return;
                    }
                } catch (statusError) {
                    console.error('Error checking transaction status:', statusError);
                }

                // If we get here, the transaction truly failed
                await bot.sendMessage(chatId, 
                    `❌ *Withdrawal Failed*\n\n` +
                    `Error: ${error.message}\n\n` +
                    `Please try again later.`, {
                    parse_mode: 'Markdown'
                });
            }
        }
    }
});

// Add network toggle command
bot.onText(/\/network/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const currentNetwork = userNetworks.get(userId.toString()) || 'mainnet';
    const newNetwork = currentNetwork === 'mainnet' ? 'testnet' : 'mainnet';
    
    // Update user's network preference
    userNetworks.set(userId.toString(), newNetwork);
    
    // Update connection based on network
    const connection = new Connection(
        newNetwork === 'mainnet' 
            ? 'https://api.mainnet-beta.solana.com'
            : 'https://api.testnet.solana.com',
        'confirmed'
    );
    
    const networkKeyboard = {
        inline_keyboard: [
            [{ text: "💳 View Wallet", callback_data: "view_wallet" }],
            [{ text: "📊 Check Balance", callback_data: "check_balance" }]
        ]
    };
    
    await bot.sendMessage(chatId, 
        `🔄 *Network Switched Successfully!*\n\n` +
        `Current Network: *${newNetwork.toUpperCase()}*\n\n` +
        `*Fee Structure:*\n` +
        `• Transaction Fee: *0.01 SOL* per tip\n` +
        `• Network Fee: *~0.000005 SOL* per transaction\n\n` +
        `*Note:* Make sure you have enough SOL to cover both the tip amount and fees.`, {
        parse_mode: 'Markdown',
        reply_markup: networkKeyboard
    });
});

// Secret command to count total users
bot.onText(/\/kitne/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const result = await pool.query('SELECT COUNT(*) as total_users FROM user_wallets');
        const totalUsers = result.rows[0].total_users;
        
        await bot.sendMessage(chatId, 
            `🤫 *Secret Stats*\n\n` +
            `Total Users: *${totalUsers}*`, {
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Error counting users:', error);
        await bot.sendMessage(chatId, '❌ Error fetching user count.');
    }
});