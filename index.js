require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    PermissionsBitField,
    Partials
} = require('discord.js');

const {
    initDataStore,
    loadData,
    saveData,
    ensureUser,
    addPoints,
    addPointLog
} = require('./utils/dataManager');

const checkLevelUp = require('./utils/levelManager');
const shop = require('./config/shop');
const gacha = require('./config/gacha');
const settings = require('./config/settings');

const ADMIN_USER_ID = "961521384264175626";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]
});

const ROLE_MAP = {
    "1365915285613182977": "1505148838346887228",
    "1225420846475247726": "1505150004627505283",
    "1003612342027833375": "1505149957215358996",
    "1029730900507906088": "1505150121468366978",
    "1476162901059305472": "1505149923677573190",
    "834745010900566046": "1505149190160912455",
    "1462957880943575111": "1505149344980930750",
    "260269196724797451": "1505150679906254961",
    "637474054927941643": "1505150622108876880",
    "718082438953173062": "1505839509500198942",
    "1351184608850612324": "1505150031915913246"
};

const explosionGif =
    "https://media.tenor.com/x8v1oNUOmg4AAAAd/explosion-anime.gif";

const timeoutList = [5, 10, 15, 30, 60];

function getJstDateString() {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().slice(0, 10);
}

function getJstHourMinute() {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);

    return {
        hour: jst.getUTCHours(),
        minute: jst.getUTCMinutes()
    };
}

function rollDailyRoulette() {
    const table = [
        { chance: 0.5, points: 100 },
        { chance: 4.5, points: 75 },
        { chance: 5, points: 50 },
        { chance: 10, points: 35 },
        { chance: 10, points: 30 },
        { chance: 10, points: 25 },
        { chance: 20, points: 20 },
        { chance: 40, points: 10 }
    ];

    const roll = Math.random() * 100;
    let total = 0;

    for (const item of table) {
        total += item.chance;
        if (roll < total) return item.points;
    }

    return 10;
}

function getVcDecayMultiplier(minutes) {
    const hour = Math.floor(minutes / 60);

    if (hour <= 0) return 1.0;
    if (hour === 1) return 0.9;
    if (hour === 2) return 0.8;
    if (hour === 3) return 0.7;
    if (hour === 4) return 0.6;

    return 0.5;
}

async function announceLevelUp(guild, member, result, fallbackChannel = null) {
    if (!result.leveledUp) return;

    let channel = fallbackChannel;

    if (settings.LEVEL_ANNOUNCE_CHANNEL_ID) {
        try {
            channel = await guild.channels.fetch(settings.LEVEL_ANNOUNCE_CHANNEL_ID);
        } catch {}
    }

    if (!channel || !channel.send) return;

    await channel.send(
        `🎉 <@${member.id}> が Lv.${result.newLevel} にレベルアップしました！`
    );
}

async function addEarnedPointsAndCheckLevel({
    guild,
    member,
    data,
    amount,
    fallbackChannel = null
}) {
    addPoints(data, member.id, amount, { addToLevel: true });

    const result = await checkLevelUp(member, data.users[member.id]);

    await announceLevelUp(guild, member, result, fallbackChannel);
}

const commands = [
    new SlashCommandBuilder()
        .setName('balance')
        .setDescription('ポイント確認'),

    new SlashCommandBuilder()
        .setName('rank')
        .setDescription('ランキング'),

    new SlashCommandBuilder()
        .setName('shop')
        .setDescription('ショップ'),

    new SlashCommandBuilder()
        .setName('buy')
        .setDescription('アイテム購入')
        .addStringOption(option =>
            option
                .setName('item')
                .setDescription('商品名')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('gacha')
        .setDescription('ガチャ'),

    new SlashCommandBuilder()
        .setName('daily')
        .setDescription('1日1回無料のデイリールーレット'),

    new SlashCommandBuilder()
        .setName('give')
        .setDescription('相手にポイントを譲渡')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('譲渡相手')
                .setRequired(true)
        )
        .addNumberOption(option =>
            option
                .setName('amount')
                .setDescription('譲渡ポイント')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('addpoint')
        .setDescription('管理者専用：ポイントを追加')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('追加する相手')
                .setRequired(true)
        )
        .addNumberOption(option =>
            option
                .setName('amount')
                .setDescription('追加するポイント')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('workcheck')
        .setDescription('作業確認をしてVC減衰をリセット'),

    new SlashCommandBuilder()
        .setName('log')
        .setDescription('直近20件のポイントログを表示'),

    new SlashCommandBuilder()
        .setName('setcolor')
        .setDescription('ロールカラー変更'),

    new SlashCommandBuilder()
        .setName('mutebomb')
        .setDescription('このチャンネルの爆弾ON/OFF')
].map(c => c.toJSON());

const rest =
    new REST({ version: '10' })
        .setToken(process.env.TOKEN);

client.once('clientReady', async () => {
    console.log(`${client.user.tag} 起動`);

    await initDataStore();

    await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
    );

    setInterval(handleVoicePoints, 60 * 1000);
    setInterval(handleDailyReminder, 60 * 1000);
});

async function handleVoicePoints() {
    const data = loadData();

    for (const guild of client.guilds.cache.values()) {
        await guild.members.fetch();

        const voiceMembers =
            guild.members.cache.filter(member =>
                !member.user.bot &&
                member.voice.channel
            );

        for (const member of voiceMembers.values()) {
            ensureUser(data, member.id);

            const user = data.users[member.id];

            const isStreaming = member.voice.streaming;
            const micOn =
                !member.voice.selfMute &&
                !member.voice.serverMute;

            const workCheckedRecently =
                Date.now() - user.lastWorkCheck <=
                settings.WORK_CHECK_RESET_MINUTES * 60 * 1000;

            if (isStreaming || micOn || workCheckedRecently) {
                user.vcSessionMinutes = 0;
            } else {
                user.vcSessionMinutes += 1;
            }

            const multiplier =
                getVcDecayMultiplier(user.vcSessionMinutes);

            const gain =
                settings.VC_POINT_PER_MINUTE * multiplier;

            await addEarnedPointsAndCheckLevel({
                guild,
                member,
                data,
                amount: gain,
                fallbackChannel: null
            });

            addPointLog(data, {
                userId: member.id,
                type: 'voice',
                amount: gain,
                hourly: true
            });
        }
    }

    saveData(data);
}

async function handleDailyReminder() {
    const { hour, minute } = getJstHourMinute();
    const today = getJstDateString();

    if (
        hour !== settings.DAILY_REMINDER_HOUR_JST ||
        minute !== settings.DAILY_REMINDER_MINUTE_JST
    ) {
        return;
    }

    const data = loadData();

    if (data.dailyReminderSentDate === today) return;

    const channelId = settings.DAILY_REMINDER_CHANNEL_ID;
    if (!channelId || channelId.includes("ここに")) return;

    let channel;

    try {
        channel = await client.channels.fetch(channelId);
    } catch {
        return;
    }

    const mentions = [];

    for (const [userId, userData] of Object.entries(data.users)) {
        if (userData.lastDailyDate !== today) {
            mentions.push(`<@${userId}>`);
        }
    }

    if (mentions.length > 0) {
        for (let i = 0; i < mentions.length; i += 30) {
            const chunk = mentions.slice(i, i + 30);

            await channel.send(
                `🎡 デイリールーレットがまだです！ ${chunk.join(' ')}\n` +
                `/daily で今日の無料ポイントを受け取れます。`
            );
        }
    }

    data.dailyReminderSentDate = today;
    saveData(data);
}

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const data = loadData();

    ensureUser(data, message.author.id);

    const member =
        await message.guild.members.fetch(message.author.id);

    await addEarnedPointsAndCheckLevel({
        guild: message.guild,
        member,
        data,
        amount: settings.MESSAGE_POINT,
        fallbackChannel: message.channel
    });

    addPointLog(data, {
        userId: message.author.id,
        type: 'message',
        amount: settings.MESSAGE_POINT,
        hourly: true
    });

    if (!data.mutedBombChannels.includes(message.channel.id)) {
        if (Math.random() <= settings.BOMB_CHANCE) {
            try {
                const seconds =
                    timeoutList[Math.floor(Math.random() * timeoutList.length)];

                await message.channel.send(
                    `${explosionGif}\n` +
                    `💥 <@${message.author.id}> 爆発！\n` +
                    `${seconds}秒タイムアウト！`
                );

                await member.timeout(seconds * 1000, '爆弾');
            } catch (err) {
                console.error(err);
            }
        }
    }

    saveData(data);
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    try {
        if (reaction.partial) await reaction.fetch();
    } catch {
        return;
    }

    const message = reaction.message;
    if (!message.guild) return;

    const data = loadData();

    const member =
        await message.guild.members.fetch(user.id);

    await addEarnedPointsAndCheckLevel({
        guild: message.guild,
        member,
        data,
        amount: settings.REACTION_POINT,
        fallbackChannel: message.channel
    });

    addPointLog(data, {
        userId: user.id,
        type: 'reaction',
        amount: settings.REACTION_POINT,
        hourly: true
    });

    saveData(data);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const data = loadData();
    const userId = interaction.user.id;

    ensureUser(data, userId);

    if (interaction.commandName === 'log') {
        try {
            if (!data.logs) data.logs = [];

            if (data.logs.length === 0) {
                return interaction.reply({
                    content: 'ログはまだありません。',
                    ephemeral: true
                });
            }

            const recentLogs = data.logs.slice(-20).reverse();

            let text = '📜 直近20件のポイントログ\n\n';

            for (const log of recentLogs) {
                const amount = Number(log.amount || 0);
                const sign = amount >= 0 ? '+' : '';
                const userText = log.userId ? `<@${log.userId}>` : '不明ユーザー';

                if (log.hourlyKey) {
                    text +=
                        `🕒 ${log.detail || log.time || '時間不明'} ` +
                        `${userText} ${sign}${amount.toFixed(1)}pt\n`;
                } else {
                    text +=
                        `${log.type || 'unknown'} ` +
                        `${userText} ${sign}${amount.toFixed(1)}pt`;

                    if (log.detail) {
                        text += ` (${log.detail})`;
                    }

                    text += '\n';
                }
            }

            if (text.length > 1900) {
                text = text.slice(0, 1900) + '\n...';
            }

            return interaction.reply({
                content: text,
                ephemeral: true
            });

        } catch (err) {
            console.error(err);

            return interaction.reply({
                content: 'ログ表示中にエラーが発生しました。',
                ephemeral: true
            });
        }
    }

    if (interaction.commandName === 'balance') {
        const user = data.users[userId];

        return interaction.reply({
            content:
                `💰 所持pt: ${user.points.toFixed(1)}pt\n` +
                `📈 レベル用累計pt: ${user.levelPoints.toFixed(1)}pt\n` +
                `Lv.${user.level}`
        });
    }

    if (interaction.commandName === 'rank') {
        const ranking =
            Object.entries(data.users)
                .sort((a, b) => b[1].points - a[1].points)
                .slice(0, 10);

        let text = '🏆 所持ポイントランキング\n\n';

        for (let i = 0; i < ranking.length; i++) {
            const user = await client.users.fetch(ranking[i][0]);

            text +=
                `${i + 1}. ${user.username} - ` +
                `${ranking[i][1].points.toFixed(1)}pt\n`;
        }

        return interaction.reply({ content: text });
    }

    if (interaction.commandName === 'shop') {
        let text = '🛒 SHOP\n\n';

        for (const [name, item] of Object.entries(shop)) {
            text += `${name} : ${item.price}pt\n`;
        }

        return interaction.reply({ content: text });
    }

    if (interaction.commandName === 'buy') {
        const itemName =
            interaction.options.getString('item');

        const item = shop[itemName];

        if (!item) {
            return interaction.reply({
                content: '存在しない商品です。',
                ephemeral: true
            });
        }

        if (data.users[userId].points < item.price) {
            return interaction.reply({
                content: 'ポイント不足です。',
                ephemeral: true
            });
        }

        const member =
            await interaction.guild.members.fetch(userId);

        await member.roles.add(item.roleId);

        data.users[userId].points -= item.price;

        addPointLog(data, {
            userId,
            type: 'buy',
            amount: -item.price,
            detail: itemName
        });

        saveData(data);

        if (itemName === 'admin12h') {
            setTimeout(async () => {
                try {
                    await member.roles.remove(item.roleId);
                } catch {}
            }, 12 * 60 * 60 * 1000);
        }

        return interaction.reply({
            content: '購入成功！'
        });
    }

    if (interaction.commandName === 'gacha') {
        if (data.users[userId].points < gacha.cost) {
            return interaction.reply({
                content: 'ポイント不足です。',
                ephemeral: true
            });
        }

        data.users[userId].points -= gacha.cost;

        addPointLog(data, {
            userId,
            type: 'gacha',
            amount: -gacha.cost,
            detail: 'role gacha'
        });

        const roll = Math.random();

        const member =
            await interaction.guild.members.fetch(userId);

        if (roll <= gacha.goldenChance) {
            await member.roles.add(gacha.goldenRole);

            saveData(data);

            return interaction.reply({
                content: '🌟 GOLDEN ROLE獲得！'
            });
        }

        if (roll <= gacha.normalChance + gacha.goldenChance) {
            const roleId =
                gacha.normalRoles[
                    Math.floor(Math.random() * gacha.normalRoles.length)
                ];

            await member.roles.add(roleId);

            saveData(data);

            return interaction.reply({
                content: '🎉 ロール獲得！'
            });
        }

        saveData(data);

        return interaction.reply({
            content: '😢 ハズレ！'
        });
    }

    if (interaction.commandName === 'daily') {
        const today = getJstDateString();

        if (data.users[userId].lastDailyDate === today) {
            return interaction.reply({
                content: '今日はすでにデイリールーレットを使用済みです。',
                ephemeral: true
            });
        }

        const points = rollDailyRoulette();

        const member =
            await interaction.guild.members.fetch(userId);

        await addEarnedPointsAndCheckLevel({
            guild: interaction.guild,
            member,
            data,
            amount: points,
            fallbackChannel: interaction.channel
        });

        data.users[userId].lastDailyDate = today;

        addPointLog(data, {
            userId,
            type: 'daily',
            amount: points,
            detail: 'daily roulette'
        });

        saveData(data);

        return interaction.reply({
            content: `🎡 デイリールーレット結果: ${points}pt 獲得！`
        });
    }

    if (interaction.commandName === 'give') {
        const target =
            interaction.options.getUser('user');

        const amount =
            interaction.options.getNumber('amount');

        if (target.bot) {
            return interaction.reply({
                content: 'Botには譲渡できません。',
                ephemeral: true
            });
        }

        if (target.id === userId) {
            return interaction.reply({
                content: '自分には譲渡できません。',
                ephemeral: true
            });
        }

        if (!amount || amount <= 0) {
            return interaction.reply({
                content: '1より大きいポイントを指定してください。',
                ephemeral: true
            });
        }

        ensureUser(data, target.id);
        ensureUser(data, ADMIN_USER_ID);

        if (data.users[userId].points < amount) {
            return interaction.reply({
                content: 'ポイント不足です。',
                ephemeral: true
            });
        }

        const fee = amount * settings.GIVE_FEE_RATE;
        const received = amount - fee;

        data.users[userId].points -= amount;

        addPoints(data, target.id, received, { addToLevel: false });
        addPoints(data, ADMIN_USER_ID, fee, { addToLevel: false });

        addPointLog(data, {
            userId,
            type: 'give',
            amount: -amount,
            detail: `to ${target.id}`
        });

        addPointLog(data, {
            userId: target.id,
            type: 'receive',
            amount: received,
            detail: `from ${userId}`
        });

        addPointLog(data, {
            userId: ADMIN_USER_ID,
            type: 'fee',
            amount: fee,
            detail: `from ${userId}`
        });

        saveData(data);

        return interaction.reply({
            content:
                `💸 <@${target.id}> に ${received.toFixed(1)}pt 譲渡しました。\n` +
                `手数料 ${fee.toFixed(1)}pt は <@${ADMIN_USER_ID}> に送られました。`
        });
    }

    if (interaction.commandName === 'addpoint') {
        if (
            !interaction.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            )
        ) {
            return interaction.reply({
                content: '管理者専用です。',
                ephemeral: true
            });
        }

        const target = interaction.options.getUser('user');
        const amount = interaction.options.getNumber('amount');

        if (!amount || amount <= 0) {
            return interaction.reply({
                content: '1より大きい数値を指定してください。',
                ephemeral: true
            });
        }

        ensureUser(data, target.id);

        addPoints(data, target.id, amount, { addToLevel: false });

        addPointLog(data, {
            userId: target.id,
            type: 'addpoint',
            amount,
            detail: `by ${userId}`
        });

        saveData(data);

        return interaction.reply({
            content: `<@${target.id}> に ${amount}pt を追加しました。`
        });
    }

    if (interaction.commandName === 'workcheck') {
        data.users[userId].lastWorkCheck = Date.now();
        data.users[userId].vcSessionMinutes = 0;

        saveData(data);

        return interaction.reply({
            content: '✅ 作業確認完了！VC減衰をリセットしました。',
            ephemeral: true
        });
    }

    if (interaction.commandName === 'setcolor') {
        const roleId = ROLE_MAP[userId];

        if (!roleId) {
            return interaction.reply({
                content: '対応ロールがありません。',
                ephemeral: true
            });
        }

        const now = Date.now();
        const cooldown = 24 * 60 * 60 * 1000;

        const last = data.colorCooldowns[userId];

        if (last && now - last < cooldown) {
            return interaction.reply({
                content: '1日1回までです。',
                ephemeral: true
            });
        }

        const r = Math.floor(Math.random() * 256);
        const g = Math.floor(Math.random() * 256);
        const b = Math.floor(Math.random() * 256);

        const hex =
            '#' +
            r.toString(16).padStart(2, '0') +
            g.toString(16).padStart(2, '0') +
            b.toString(16).padStart(2, '0');

        try {
            const role =
                await interaction.guild.roles.fetch(roleId);

            await role.setColor(hex);

            data.colorCooldowns[userId] = now;

            saveData(data);

            return interaction.reply({
                content:
                    `変更完了！\n` +
                    `RGB(${r}, ${g}, ${b})\n` +
                    `${hex}`
            });
        } catch (err) {
            console.error(err);

            return interaction.reply({
                content: '変更失敗。',
                ephemeral: true
            });
        }
    }

    if (interaction.commandName === 'mutebomb') {
        if (
            !interaction.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            )
        ) {
            return interaction.reply({
                content: '管理者専用です。',
                ephemeral: true
            });
        }

        const channelId = interaction.channel.id;

        if (data.mutedBombChannels.includes(channelId)) {
            data.mutedBombChannels =
                data.mutedBombChannels.filter(id => id !== channelId);

            saveData(data);

            return interaction.reply({
                content: '爆弾を有効化しました。'
            });
        }

        data.mutedBombChannels.push(channelId);

        saveData(data);

        return interaction.reply({
            content: '爆弾を無効化しました。'
        });
    }
});

client.login(process.env.TOKEN);