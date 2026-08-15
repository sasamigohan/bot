'use strict';

/**
 * ラジオ体操イベント
 *
 * 既存の破片通知（shard/shardScheduler.js）と同じ流儀で、
 * client.once('clientReady', ...) 内から setInterval で毎分呼び出す。
 *
 * 1日の流れ（イベント期間中＝ /radio-start 済みのときだけ動く）:
 *   1. 8:50 JST  対象VCに参加し、参加ログの収集を開始する
 *                （このときVCにいる人＋以降に入ってきた人を記録）
 *   2. 9:00 JST  ラジオ体操第一の音声を再生する
 *   3. 再生終了  そこまでにVCにいた人を確定し、VCから切断。
 *                【本日のラジオ体操参加者】を告知チャンネルに投稿し、
 *                参加者に DAILY_POINT を付与、参加日を記録する
 *   4. /radio-end（約1ヶ月のイベント終了時）で参加日数ランキングを発表し、
 *      1位に TOP_BONUS_POINT を付与する
 *
 * 音声再生には @discordjs/voice 等の追加パッケージが必要。
 * 未インストール／音源ファイルが無い場合でも Bot 全体は落とさず、
 * 「再生だけスキップ」して参加記録とポイント付与は通常どおり行う。
 */

const fs = require('fs');
const path = require('path');

const { PermissionsBitField, ChannelType, GatewayIntentBits } = require('discord.js');

const { ensureUser, addPoints, addPointLog } = require('../utils/dataManager');

// 対象のボイスチャンネル
const RADIO_VC_ID = '1496874003413864570';
// 参加者一覧・ランキングを投稿するテキストチャンネル
const RADIO_ANNOUNCE_CHANNEL_ID = '1453193177581486100';

// VCに入って参加ログの収集を始める時刻（JST）
const RADIO_JOIN_HOUR = 8;
const RADIO_JOIN_MINUTE = 50;
// 音声を流し始める時刻（JST）
const RADIO_PLAY_HOUR = 9;
const RADIO_PLAY_MINUTE = 0;

// 参加者1人あたりの1日のポイント
const DAILY_POINT = 50;
// 最終ランキング1位のボーナスポイント
const TOP_BONUS_POINT = 1000;

// 再生が終わらないまま居座るのを防ぐための保険（ラジオ体操第一は約3分半）
const MAX_PLAY_MS = 10 * 60 * 1000;
// ボイス接続がReadyになるのを待つ上限
const VOICE_READY_TIMEOUT_MS = 30 * 1000;
// 何らかの理由で再生を開始できなかった場合に、収集を打ち切る猶予
const MAX_SESSION_MS = 30 * 60 * 1000;

// 音源ファイルの探索先（RADIO_TAISO_AUDIO で明示指定も可能）
const AUDIO_DIR = path.join(__dirname, '..', 'assets');
const AUDIO_BASENAME = 'radio-taiso';
const AUDIO_EXTENSIONS = ['.ogg', '.opus', '.webm', '.mp3', '.m4a', '.wav'];

// joinVoiceChannel で作った接続。プロセス内でのみ保持する
let currentConnection = null;

function getJstDateString(date = new Date()) {
    const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().slice(0, 10);
}

function getJstHourMinute(date = new Date()) {
    const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return {
        hour: jst.getUTCHours(),
        minute: jst.getUTCMinutes()
    };
}

function ensureRadioData(data) {
    if (!data.radioTaiso) {
        data.radioTaiso = {
            active: false,
            startedDate: null,
            lastSessionDate: null,
            attendance: {},
            session: null
        };
    }

    if (!data.radioTaiso.attendance) data.radioTaiso.attendance = {};

    return data.radioTaiso;
}

/**
 * 音声再生に必要なパッケージをまとめて読み込む。
 * 未インストールなら null を返し、呼び出し側で再生をスキップする。
 */
function loadVoiceLibs() {
    try {
        const voice = require('@discordjs/voice');
        prepareFfmpeg();
        return voice;
    } catch (err) {
        console.error('[radioTaiso] @discordjs/voice を読み込めませんでした:', err);
        return null;
    }
}

/**
 * 実在する ffmpeg のパスを返す。見つからなければ null。
 * ffmpeg-static は optionalDependencies なので、
 * requireできてもバイナリのダウンロードに失敗している場合がある。
 * そのため必ず存在確認する。
 */
function resolveFfmpegPath() {
    const candidates = [];

    if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);

    try {
        const ffmpegStatic = require('ffmpeg-static');
        const staticPath = ffmpegStatic && (ffmpegStatic.path || ffmpegStatic);
        if (typeof staticPath === 'string') candidates.push(staticPath);
    } catch {
        // ffmpeg-static が無くても、PATH上のffmpegやOgg音源なら動く
    }

    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) return candidate;
    }

    return null;
}

/**
 * prism-media 1.3.x の ffmpeg 探索は
 * [ffmpeg-static, 'ffmpeg', 'avconv', './ffmpeg', './avconv'] の固定順で、
 * FFMPEG_PATH 環境変数を見てくれない。
 * そこで FFMPEG_PATH のディレクトリを PATH の先頭に通し、
 * 'ffmpeg' としてspawnされたときに解決できるようにする。
 */
function prepareFfmpeg() {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath) return;

    const dir = path.dirname(ffmpegPath);
    const sep = process.platform === 'win32' ? ';' : ':';
    const current = process.env.PATH || '';

    if (!current.split(sep).includes(dir)) {
        process.env.PATH = `${dir}${sep}${current}`;
    }
}

/**
 * ffmpeg（PATH上のものを含む）が実際に起動できるか確認する
 */
function isFfmpegAvailable() {
    prepareFfmpeg();

    const { spawnSync } = require('child_process');

    for (const command of ['ffmpeg', 'avconv']) {
        try {
            const result = spawnSync(command, ['-h'], { windowsHide: true });
            if (!result.error) return true;
        } catch {
            // 次の候補へ
        }
    }

    return false;
}

/**
 * 再生の前提条件が揃っているか調べる。
 * 起動時ログや /radio-test での事前確認に使う。
 * @returns {{ok: boolean, reason: string, audioPath: string|null}}
 */
function describeAudioSetup() {
    const audioPath = resolveAudioPath();

    if (!audioPath) {
        return {
            ok: false,
            audioPath: null,
            reason:
                '音源ファイルが見つかりません。' +
                `${AUDIO_DIR} に ${AUDIO_BASENAME}.ogg 等を置くか、環境変数 RADIO_TAISO_AUDIO で指定してください。`
        };
    }

    try {
        require('@discordjs/voice');
    } catch {
        return {
            ok: false,
            audioPath,
            reason: '@discordjs/voice が未インストールです。npm install を実行してください。'
        };
    }

    const ext = path.extname(audioPath).toLowerCase();
    const needsFfmpeg = !['.ogg', '.opus', '.webm'].includes(ext);

    if (needsFfmpeg && !isFfmpegAvailable()) {
        return {
            ok: false,
            audioPath,
            reason:
                `${ext} の再生には ffmpeg が必要ですが、実行できる ffmpeg が見つかりません。` +
                'ffmpeg をインストールする（Ubuntu: sudo apt install -y ffmpeg）か、' +
                '音源を .ogg (Ogg/Opus) に変換してください。'
        };
    }

    return { ok: true, audioPath, reason: `音源: ${audioPath}` };
}

/**
 * 再生する音源ファイルのパスを返す。見つからなければ null。
 */
function resolveAudioPath() {
    const configured = process.env.RADIO_TAISO_AUDIO;

    if (configured) {
        const resolved = path.isAbsolute(configured)
            ? configured
            : path.join(__dirname, '..', configured);

        return fs.existsSync(resolved) ? resolved : null;
    }

    for (const ext of AUDIO_EXTENSIONS) {
        const candidate = path.join(AUDIO_DIR, `${AUDIO_BASENAME}${ext}`);
        if (fs.existsSync(candidate)) return candidate;
    }

    return null;
}

/**
 * 拡張子から @discordjs/voice の inputType を決める。
 * Ogg/Opus・WebM/Opus ならffmpegも音声エンコーダも不要で最も軽い。
 */
function getInputType(voice, audioPath) {
    const ext = path.extname(audioPath).toLowerCase();

    if (ext === '.ogg' || ext === '.opus') return voice.StreamType.OggOpus;
    if (ext === '.webm') return voice.StreamType.WebmOpus;

    return voice.StreamType.Arbitrary;
}

async function fetchAnnounceChannel(client) {
    try {
        return await client.channels.fetch(RADIO_ANNOUNCE_CHANNEL_ID);
    } catch (err) {
        console.error('[radioTaiso] 告知チャンネルを取得できません:', err.message);
        return null;
    }
}

async function fetchVoiceChannel(client) {
    try {
        return await client.channels.fetch(RADIO_VC_ID);
    } catch (err) {
        console.error('[radioTaiso] ボイスチャンネルを取得できません:', err.message);
        return null;
    }
}

/**
 * いまVCにいる人（Bot以外）を参加ログに追加する。
 * @returns {boolean} 新しく追加された人がいたか
 */
function collectCurrentMembers(voiceChannel, session) {
    if (!voiceChannel || !voiceChannel.guild) return false;

    // voiceChannel.members はメンバーキャッシュに載っている人しか返さない。
    // このBotは全メンバーfetchが失敗することがあり取りこぼすため、
    // ボイス状態のキャッシュから直接在室者を引く。
    const voiceStates = voiceChannel.guild.voiceStates.cache;
    const selfId = voiceChannel.client && voiceChannel.client.user
        ? voiceChannel.client.user.id
        : null;

    let added = false;

    for (const voiceState of voiceStates.values()) {
        if (voiceState.channelId !== voiceChannel.id) continue;

        const userId = voiceState.id;

        if (userId === selfId) continue;
        // メンバー情報が取れない場合は、Botかどうか判断できないので人として扱う
        if (voiceState.member && voiceState.member.user.bot) continue;
        if (session.participants.includes(userId)) continue;

        session.participants.push(userId);
        added = true;
    }

    return added;
}

function disconnectVoice() {
    if (!currentConnection) return;

    try {
        currentConnection.destroy();
    } catch {
        // すでに切断済みの場合は何もしない
    }

    currentConnection = null;
}

/**
 * 8:50: VCに参加して、その日の参加ログ収集を始める
 */
async function startMorningSession(client, data, saveData, today) {
    const radio = ensureRadioData(data);
    const voiceChannel = await fetchVoiceChannel(client);

    radio.session = {
        date: today,
        participants: [],
        phase: 'collecting',
        startedAt: Date.now(),
        playStartedAt: null
    };
    radio.lastSessionDate = today;

    if (voiceChannel) {
        collectCurrentMembers(voiceChannel, radio.session);
    }

    saveData(data);

    console.log(
        `[radioTaiso] ${today} の参加ログ収集を開始しました` +
        `（開始時点の在室: ${radio.session.participants.length}人）`
    );

    // 8:50〜9:00 はVCに接続しない。
    // 参加ログの収集は voiceStateUpdate とVCの在室者ポーリングで行うため、
    // Bot自身がVCに入っている必要がない。
    // ここで接続すると、失敗時に再接続を繰り返してBotが出入りして見えるため、
    // 接続は再生直前（9:00）にまとめて行う。
}

/**
 * 9:00: 音声を再生する。再生終了（または失敗）後に締め処理へ進む。
 */
async function playRadioTaiso(client, data, saveData) {
    const radio = ensureRadioData(data);
    const session = radio.session;

    if (!session) return;

    session.phase = 'playing';
    session.playStartedAt = Date.now();
    saveData(data);

    const voiceChannel = await fetchVoiceChannel(client);
    const result = await playAudioInChannel(voiceChannel, client);

    if (!result.ok) {
        console.error('[radioTaiso] 音声の再生に失敗しました:', result.reason);
    }

    await finishMorningSession(client, data, saveData, {
        played: result.ok,
        reason: result.reason
    });
}

/**
 * 指定VCに接続して音源を最後まで再生する。
 * 例外を投げず、必ず {ok, reason} を返す。
 *
 * AudioPlayer の 'error' は listener が無いと Node が例外を投げ、
 * try/catch では捕まえられずプロセスごと落ちる。
 * そのため play() より前に必ずハンドラを登録する。
 */
/**
 * Botが対象VCに入って喋れる状態かを事前に確認する。
 * 権限不足だと joinVoiceChannel はエラーを投げず、
 * ただReadyにならないまま entersState がタイムアウトするだけなので、
 * ここで先に潰しておくと原因が一目で分かる。
 * @returns {string|null} 問題があればその説明、無ければ null
 */
function checkVoicePermissions(voiceChannel) {
    // テキストチャンネル等のIDを指定していると、joinVoiceChannel はエラーを出さず
    // signalling のまま固まる（Discordが要求を黙って無視するため）。
    if (
        voiceChannel.type !== ChannelType.GuildVoice &&
        voiceChannel.type !== ChannelType.GuildStageVoice
    ) {
        return (
            `対象チャンネル(${RADIO_VC_ID})がボイスチャンネルではありません` +
            `（種別: ${voiceChannel.type}、名前: ${voiceChannel.name}）。IDを確認してください。`
        );
    }

    const me = voiceChannel.guild.members.me;

    if (!me) return 'Botのメンバー情報を取得できませんでした。';

    const perms = voiceChannel.permissionsFor(me);

    if (!perms) return 'BotのVCに対する権限を取得できませんでした。';

    const missing = [];

    if (!perms.has(PermissionsBitField.Flags.ViewChannel)) missing.push('チャンネルを見る');
    if (!perms.has(PermissionsBitField.Flags.Connect)) missing.push('接続');
    if (!perms.has(PermissionsBitField.Flags.Speak)) missing.push('発言');

    if (missing.length > 0) {
        return `Botに必要な権限がありません: ${missing.join(' / ')}`;
    }

    if (
        voiceChannel.userLimit > 0 &&
        voiceChannel.members.size >= voiceChannel.userLimit &&
        !perms.has(PermissionsBitField.Flags.MoveMembers)
    ) {
        return 'VCが人数上限に達しているため接続できません。';
    }

    return null;
}

/**
 * 音声WebSocketの切断コードを日本語で説明する。
 * https://discord.com/developers/docs/topics/opcodes-and-status-codes#voice
 */
function describeVoiceCloseCode(code) {
    const table = {
        4001: '不明なオペコード',
        4002: 'ペイロードのデコードに失敗',
        4003: '認証されていません',
        4004: '認証に失敗（トークンが不正）',
        4005: '既に認証済み',
        4006: 'セッションが無効です',
        4009: 'セッションがタイムアウト',
        4011: 'サーバーが見つかりません',
        4012: '不明なプロトコル',
        4014: '切断されました（キック/チャンネル削除/権限喪失）',
        4015: 'ボイスサーバーがクラッシュ',
        4016: '不明な暗号化方式',
        4017: 'ボイスゲートウェイのバージョンが古い（@discordjs/voice を 0.19 以上に更新してください）',
        4020: '不正なリクエスト',
        4021: 'レート制限による切断',
        4022: '通話が終了しました'
    };

    return table[code] || '詳細不明';
}

/**
 * 高番号ポートの外向きUDPが通るかを実測する。
 *
 * Discordのボイスは 50000番台などの高番号UDPを使う。
 * ここが塞がれていると、音声WebSocketは張れても
 * IPディスカバリ(UDP)が完了せず connecting → signalling を延々と往復する。
 *
 * GoogleのSTUNサーバー(UDP 19302)にBinding Requestを投げ、
 * 応答が返るかどうかで高番号UDPの疎通を判定する。
 */
function checkUdpEgress(timeoutMs = 5000) {
    return new Promise(resolve => {
        const dgram = require('dgram');
        const socket = dgram.createSocket('udp4');

        // STUN Binding Request: type(0x0001) + length(0) + magic cookie + transaction id
        const request = Buffer.alloc(20);
        request.writeUInt16BE(0x0001, 0);
        request.writeUInt16BE(0x0000, 2);
        request.writeUInt32BE(0x2112a442, 4);
        require('crypto').randomFillSync(request, 8, 12);

        let settled = false;

        const finish = result => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            try {
                socket.close();
            } catch {
                // すでに閉じていれば無視
            }

            resolve(result);
        };

        const timer = setTimeout(
            () => finish({ ok: false, reason: `UDP応答なし（${timeoutMs}ms待機）` }),
            timeoutMs
        );

        socket.on('message', msg => {
            // 0x0101 = Binding Success Response
            if (msg.length >= 2 && msg.readUInt16BE(0) === 0x0101) {
                finish({ ok: true, reason: 'UDP疎通OK' });
            }
        });

        socket.on('error', err => finish({ ok: false, reason: `UDPエラー: ${err.message}` }));

        socket.send(request, 19302, 'stun.l.google.com', err => {
            if (err) finish({ ok: false, reason: `UDP送信失敗: ${err.message}` });
        });
    });
}

/**
 * 暗号化ライブラリを事前に読み込んでおく。
 *
 * @discordjs/voice は libsodium-wrappers を非同期(WASM)で読み込み、
 * 完了するまで暗号化メソッドが「未インストール」扱いの例外を投げる。
 * 接続処理に入る前に読み込みを完了させておく。
 */
async function ensureEncryptionReady() {
    try {
        const sodium = require('libsodium-wrappers');
        if (sodium && sodium.ready) await sodium.ready;
        return true;
    } catch (err) {
        console.error('[radioTaiso] libsodium-wrappers を読み込めません:', err.message);
        return false;
    }
}

/**
 * @discordjs/voice の依存状況レポート。
 * どの暗号化パッケージ・opusエンコーダ・ffmpegが認識されているかが分かる。
 */
function getDependencyReport() {
    try {
        const voice = require('@discordjs/voice');
        return voice.generateDependencyReport();
    } catch (err) {
        return `依存レポートを取得できません: ${err.message}`;
    }
}

/**
 * discord.js の voiceAdapterCreator をラップし、
 * @discordjs/voice との実際のやり取りを観測できるようにする。
 *
 * discord.js 側は adapters.get(guildId)?.onVoiceStateUpdate(...) という
 * オプショナルチェーンで転送するため、アダプタ未登録なら何も起きず
 * ログにも残らない。ここで実際の呼び出し回数を数えることで、
 * 「discord.jsが転送しようとした」と「VoiceConnectionが受け取った」を区別する。
 */
function createInstrumentedAdapter(guild, log) {
    return methods => {
        const wrapped = {
            onVoiceStateUpdate: packet => {
                log.state++;
                console.log('[radioTaiso] adapter: onVoiceStateUpdate 受領');
                return methods.onVoiceStateUpdate(packet);
            },
            onVoiceServerUpdate: packet => {
                log.server++;
                console.log('[radioTaiso] adapter: onVoiceServerUpdate 受領');
                return methods.onVoiceServerUpdate(packet);
            },
            destroy: () => {
                console.log('[radioTaiso] adapter: destroy');
                return methods.destroy();
            }
        };

        const inner = guild.voiceAdapterCreator(wrapped);

        return {
            sendPayload: data => {
                const ok = inner.sendPayload(data);

                if (ok) {
                    log.sent++;
                } else {
                    log.sendFailed++;
                    console.error(
                        '[radioTaiso] adapter: sendPayload 失敗（シャードがReadyではありません）'
                    );
                }

                return ok;
            },
            destroy: inner.destroy
        };
    };
}

/**
 * 接続前に、残骸になっているボイス状態を掃除する。
 *
 * signalling で固まる典型パターンが2つあり、どちらもこれで解ける:
 *   1. 前回の接続が @discordjs/voice 内部のレジストリに残っている
 *      （プロセス内変数 currentConnection がnullでも残っていることがある）
 *   2. Discord側に「Botはまだそのチャンネルにいる」という状態が残っている。
 *      この場合、同じチャンネルへ join しても状態が変化しないため
 *      VOICE_SERVER_UPDATE が返らず、永久に signalling のままになる。
 *      一度 channel_id: null を送って抜けてから入り直す必要がある。
 */
/**
 * Bot自身の GuildMember を確実にキャッシュへ載せる。
 *
 * discord.js は VOICE_STATE_UPDATE を受け取ったとき、
 *   const member = guild.members.cache.get(data.user_id);
 *   if (member?.user.id === client.user.id) client.voice.onVoiceStateUpdate(data);
 * という条件で @discordjs/voice へ転送する（actions/VoiceStateUpdate.js）。
 *
 * つまりBot自身のメンバーがキャッシュに無いと、パケットは届いているのに
 * 転送されず、接続は永久に signalling のままになる。
 * このBotは毎分の全メンバーfetchがタイムアウトすることがあり
 * （GuildMembersTimeout）、キャッシュが欠けやすいため明示的に取得しておく。
 */
async function ensureSelfMemberCached(guild, client) {
    if (!client || !client.user) return;

    try {
        await guild.members.fetch({ user: client.user.id, force: true });
        console.log('[radioTaiso] Bot自身のメンバー情報をキャッシュしました');
    } catch (err) {
        console.warn('[radioTaiso] Bot自身のメンバー取得に失敗:', err.message);
    }
}

async function clearStaleVoiceState(voice, guild) {
    disconnectVoice();

    // 1. ライブラリ側に残っている接続を破棄する
    const existing = voice.getVoiceConnection(guild.id);

    if (existing) {
        console.log('[radioTaiso] 既存のボイス接続が残っていたため破棄します');

        try {
            existing.destroy();
        } catch {
            // すでに破棄済みなら無視
        }
    }

    // 2. Discord側に残っているBot自身のボイス状態を解除する
    const me = guild.members.me;

    if (me && me.voice && me.voice.channelId) {
        console.log(`[radioTaiso] 古いボイス状態(${me.voice.channelId})を解除します`);

        try {
            await me.voice.disconnect();
        } catch (err) {
            // 権限不足などで失敗しても、続けて join を試す価値はある
            console.warn('[radioTaiso] ボイス状態の解除に失敗:', err.message);
        }

        // 解除がDiscord側に反映されるまで少し待つ
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
}

/**
 * 接続試行中にゲートウェイへ届くボイス関連パケットを直接観測する。
 *
 * signalling で固まる原因を確定させるための診断。
 * joinVoiceChannel は「ゲートウェイへ接続要求を送り、
 * VOICE_STATE_UPDATE と VOICE_SERVER_UPDATE の両方が返ってきたら次へ進む」
 * という動作なので、どちらが欠けているかで原因が切り分けられる。
 */
function watchVoiceGateway(client, guildId) {
    const seen = {
        stateUpdate: false,
        serverUpdate: false,
        endpoint: null,
        // discord.js が @discordjs/voice へ転送した時点で出す debug ログ。
        // raw で受信していてもこちらが出ない場合、discord.js内部の
        // 転送条件（Bot自身のメンバーがキャッシュにあるか）で弾かれている。
        forwardedState: false,
        forwardedServer: false
    };

    if (!client || !client.user) return { seen, stop: () => {} };

    const onDebug = message => {
        if (typeof message !== 'string') return;

        if (message.startsWith('[VOICE] received voice state update')) {
            seen.forwardedState = true;
            console.log('[radioTaiso] discord.js → voice: state update 転送OK');
        }

        if (message.startsWith('[VOICE] received voice server')) {
            seen.forwardedServer = true;
            console.log('[radioTaiso] discord.js → voice: server update 転送OK');
        }
    };

    const onRaw = packet => {
        if (!packet || !packet.t || !packet.d) return;

        if (
            packet.t === 'VOICE_STATE_UPDATE' &&
            packet.d.guild_id === guildId &&
            packet.d.user_id === client.user.id
        ) {
            seen.stateUpdate = true;
            console.log(
                `[radioTaiso] gateway: 自分のVOICE_STATE_UPDATE受信 channel_id=${packet.d.channel_id}`
            );
        }

        if (packet.t === 'VOICE_SERVER_UPDATE' && packet.d.guild_id === guildId) {
            seen.serverUpdate = true;
            seen.endpoint = packet.d.endpoint;
            console.log(`[radioTaiso] gateway: VOICE_SERVER_UPDATE受信 endpoint=${packet.d.endpoint}`);
        }
    };

    client.on('raw', onRaw);
    client.on('debug', onDebug);

    return {
        seen,
        stop: () => {
            client.off('raw', onRaw);
            client.off('debug', onDebug);
        }
    };
}

/**
 * 観測結果から原因を言葉にする
 */
function describeGatewayFindings(seen, adapterLog = null, udpCheck = null) {
    if (!seen.stateUpdate && !seen.serverUpdate) {
        return (
            '\n【診断】接続要求に対しDiscordから何も返ってきていません' +
            '（VOICE_STATE_UPDATE / VOICE_SERVER_UPDATE ともに未受信）。' +
            'ゲートウェイへ要求自体が届いていない可能性が高く、' +
            '同じトークンで別のプロセス（別サーバー・ローカル・旧デプロイ環境）が' +
            '接続していないか確認してください。'
        );
    }

    if (seen.stateUpdate && !seen.serverUpdate) {
        return (
            '\n【診断】VC参加自体は受理されましたが（VOICE_STATE_UPDATE受信）、' +
            'ボイスサーバー情報(VOICE_SERVER_UPDATE)だけが返ってきていません。' +
            'サーバー設定の「サーバーリージョン/音声リージョン」を別のリージョンに変更して' +
            '再試行すると解消することがあります。'
        );
    }

    // ここから先は「パケットは両方届いている」ケース。
    // discord.js が @discordjs/voice へ転送したかどうかで切り分ける。
    if (adapterLog && (adapterLog.state === 0 || adapterLog.server === 0)) {
        const missing = [];
        if (!adapterLog.state) missing.push('state update');
        if (!adapterLog.server) missing.push('server update');

        return (
            `\n【診断】discord.jsは転送処理まで到達していますが、` +
            `VoiceConnection が ${missing.join(' と ')} を受け取っていません` +
            `（adapter受領: state=${adapterLog.state}, server=${adapterLog.server}）。` +
            'client.voice.adapters にアダプタが登録されていない状態です。' +
            'discord.js と @discordjs/voice が別々の依存として二重に入っている' +
            '可能性があるため、npm ls discord.js @discordjs/voice で重複を確認してください。'
        );
    }

    if (adapterLog && adapterLog.sendFailed > 0) {
        return (
            `\n【診断】ゲートウェイへの送信が ${adapterLog.sendFailed} 回失敗しています。` +
            'シャードがReady状態ではありません。接続が不安定な可能性があります。'
        );
    }

    if (adapterLog && adapterLog.packets) {
        const { state, server } = adapterLog.packets;

        if (state && server) {
            // 音声WebSocketの切断コードが取れていれば、それが最も確実な情報
            if (adapterLog.closeCode) {
                const code = adapterLog.closeCode;
                let advice = '';

                if (code === 4006 || code === 4009) {
                    advice =
                        ' Botのゲートウェイセッションと音声セッションが食い違っています。' +
                        '同じトークンで別のプロセスが接続していないか、' +
                        'Developer Portalでトークンを再生成した直後でないかを確認してください。';
                } else if (code === 4004) {
                    advice = ' トークンが不正です。.env の TOKEN を確認してください。';
                } else if (code === 4014) {
                    advice =
                        ' Botがチャンネルからキックされたか、接続権限を失っています。' +
                        'VCの権限設定を確認してください。';
                } else if (code === 4016 || code === 4012) {
                    advice =
                        ' 暗号化方式のネゴシエーションに失敗しています。' +
                        'libsodium-wrappers が正しく入っているか確認してください。';
                } else if (code === 4017) {
                    advice =
                        ' Discordが古いボイスゲートウェイの受付を終了しています。' +
                        'npm install @discordjs/voice@latest で更新してください。';
                }

                return (
                    `\n【診断】★音声WebSocketが code=${code}` +
                    `（${describeVoiceCloseCode(code)}）で切断されています。${advice}`
                );
            }

            // ここまで来ている場合、接続は connecting まで進んだうえで
            // 音声サーバーとの通信に失敗し、signalling に差し戻されている。
            // 原因のほとんどは高番号UDPが外に出られないこと。
            if (udpCheck && !udpCheck.ok) {
                return (
                    '\n【診断】★外向きUDPが通っていません' +
                    `（STUNテスト結果: ${udpCheck.reason}）。` +
                    'Discordのボイスは高番号ポートのUDPを使うため、これが原因です。' +
                    'Oracle Cloudのセキュリティリスト（イングレス/エグレス）と' +
                    'ホストのiptablesで、外向きUDPと戻りの通信が許可されているか確認してください。'
                );
            }

            return (
                '\n【診断】音声サーバーへの接続まで進みましたが、通信が確立せず' +
                '再接続を繰り返しています（connecting ⇄ signalling）。' +
                (udpCheck && udpCheck.ok ? 'UDP疎通自体は確認できているため、' : '') +
                'ログの [voice-debug] 行に出ている切断コードを確認してください。'
            );
        }
    }

    if (!seen.forwardedState || !seen.forwardedServer) {
        const missing = [];
        if (!seen.forwardedState) missing.push('state update');
        if (!seen.forwardedServer) missing.push('server update');

        return (
            `\n【診断】パケットは両方受信していますが（endpoint=${seen.endpoint}）、` +
            `discord.js が @discordjs/voice へ ${missing.join(' と ')} を転送していません。` +
            'discord.jsはBot自身のGuildMemberがキャッシュに無いと転送をスキップするため、' +
            'メンバーキャッシュが原因の可能性が高いです。' +
            'この試行では事前取得を行っているので、それでも出る場合は' +
            'Botの権限（サーバーメンバーインテント）を確認してください。'
        );
    }

    return (
        '\n【診断】パケットの受信・転送とも正常です' +
        `（endpoint=${seen.endpoint}）。` +
        'にもかかわらずReadyにならないため、@discordjs/voice 側の問題です。' +
        'node_modules を削除して npm install をやり直してください。'
    );
}

/**
 * Ready状態のボイス接続を用意する。
 *
 * 前回の失敗で壊れた接続が currentConnection に残っていると、
 * それを使い回した結果 entersState が延々タイムアウトする
 * （= "The operation was aborted"）ため、状態を確認して作り直す。
 *
 * Readyにならなかった場合は最終状態を理由に含める。
 * signalling で止まる → ゲートウェイ/権限側の問題、
 * connecting で止まる → UDP がブロックされている可能性が高い、と切り分けできる。
 */
async function ensureReadyConnection(voice, voiceChannel, client = null) {
    if (
        currentConnection &&
        currentConnection.state.status === voice.VoiceConnectionStatus.Ready &&
        currentConnection.joinConfig.channelId === voiceChannel.id
    ) {
        return { ok: true };
    }

    // 1回目が signalling で固まるのは古いボイス状態が原因のことが多く、
    // その失敗自体が状態を解除してくれるため、掃除してもう一度試す価値がある。
    let lastStatus = 'なし';
    let lastAdapterLog = null;
    let udpCheck = null;

    const watcher = watchVoiceGateway(client, voiceChannel.guild.id);

    try {
        for (let attempt = 1; attempt <= 2; attempt++) {
            await ensureEncryptionReady();
            await ensureSelfMemberCached(voiceChannel.guild, client);

            if (attempt === 1) {
                udpCheck = await checkUdpEgress();
                console.log(`[radioTaiso] UDP疎通チェック: ${udpCheck.reason}`);
            }

            await clearStaleVoiceState(voice, voiceChannel.guild);

            const adapterLog = {
                state: 0,
                server: 0,
                sent: 0,
                sendFailed: 0,
                attempted: 0,
                noEffect: 0,
                rejoined: 0,
                error: null,
                closeCode: null
            };

            currentConnection = voice.joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: createInstrumentedAdapter(voiceChannel.guild, adapterLog),
                selfDeaf: false,
                selfMute: false,
                // 音声WebSocket/UDPの詳細（切断コードを含む）をログに出す
                debug: true
            });

            currentConnection.on('debug', message => {
                console.log('[radioTaiso][voice-debug]', message);
            });

            // 音声WebSocketの切断コードを拾う。
            // Networking インスタンスは再接続のたびに作り直されるので、
            // stateChange で新しいものが現れたら都度購読する。
            currentConnection.on('stateChange', (oldState, newState) => {
                const networking = newState.networking;

                if (!networking || networking === oldState.networking) return;

                networking.on('close', code => {
                    adapterLog.closeCode = code;
                    console.error(
                        `[radioTaiso] 音声WebSocketが切断されました: code=${code}` +
                        ` (${describeVoiceCloseCode(code)})`
                    );
                });
            });

            lastAdapterLog = adapterLog;

            currentConnection.on('stateChange', (oldState, newState) => {
                console.log(
                    `[radioTaiso] voice connection: ${oldState.status} -> ${newState.status}`
                );
            });

            currentConnection.on('error', err => {
                console.error('[radioTaiso] voice connection error:', err);
            });

            try {
                await voice.entersState(
                    currentConnection,
                    voice.VoiceConnectionStatus.Ready,
                    VOICE_READY_TIMEOUT_MS
                );


                return { ok: true };
            } catch {

                lastStatus = currentConnection ? currentConnection.state.status : 'なし';

                // VoiceConnection が内部に溜めたパケット。
                // 両方揃っているのに進まないのか、片方が届いていないのかが分かる。
                const packets =
                    currentConnection && currentConnection.packets
                        ? {
                              state: Boolean(currentConnection.packets.state),
                              server: Boolean(currentConnection.packets.server)
                          }
                        : null;

                console.error(
                    `[radioTaiso] 接続試行 ${attempt}/2 失敗（最終状態: ${lastStatus}）` +
                    ` adapter=${JSON.stringify(adapterLog)}` +
                    ` packets=${JSON.stringify(packets)}`
                );

                if (lastAdapterLog) lastAdapterLog.packets = packets;

                disconnectVoice();
            }
        }
    } finally {
        watcher.stop();
    }

    let hint = '';

    if (lastStatus === 'signalling') {
        const intentOk =
            !client ||
            (client.options &&
                client.options.intents &&
                client.options.intents.has(GatewayIntentBits.GuildVoiceStates));

        hint = intentOk
            ? describeGatewayFindings(watcher.seen, lastAdapterLog, udpCheck)
            : '\n【診断】GatewayIntentBits.GuildVoiceStates が有効になっていません。これが原因です。';
    } else if (lastStatus === 'connecting') {
        hint =
            '\n【診断】Discordのボイスサーバーへ UDP で到達できていません。' +
            'ファイアウォール（Oracle Cloudのセキュリティリスト/iptables）で' +
            '外向きUDPが塞がれていないか確認してください。';
    }

    return {
        ok: false,
        reason:
            `2回試しましたが、${VOICE_READY_TIMEOUT_MS / 1000}秒以内にボイス接続がReadyになりませんでした` +
            `（最終状態: ${lastStatus}）。${hint}`
    };
}

async function playAudioInChannel(voiceChannel, client = null) {
    if (!voiceChannel) {
        return { ok: false, reason: 'ボイスチャンネルを取得できませんでした。' };
    }

    const setup = describeAudioSetup();
    if (!setup.ok) return { ok: false, reason: setup.reason };

    const voice = loadVoiceLibs();
    if (!voice) {
        return { ok: false, reason: '@discordjs/voice を読み込めませんでした。' };
    }

    const permissionError = checkVoicePermissions(voiceChannel);
    if (permissionError) return { ok: false, reason: permissionError };

    const audioPath = setup.audioPath;
    let player = null;

    try {
        const connection = await ensureReadyConnection(voice, voiceChannel, client);
        if (!connection.ok) return { ok: false, reason: connection.reason };

        player = voice.createAudioPlayer({
            behaviors: { noSubscriber: voice.NoSubscriberBehavior.Play }
        });

        const stream = fs.createReadStream(audioPath);

        // 再生完了 / 失敗を1つのPromiseにまとめる。
        // 'error' ハンドラをplay()前に登録することが重要。
        const finished = new Promise(resolve => {
            let settled = false;

            const done = outcome => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(outcome);
            };

            const timer = setTimeout(
                () => done({ ok: false, reason: `再生が ${MAX_PLAY_MS / 1000}秒 で終わりませんでした。` }),
                MAX_PLAY_MS
            );

            player.on('error', err => {
                console.error('[radioTaiso] AudioPlayer error:', err);
                done({ ok: false, reason: `再生エラー: ${err.message}` });
            });

            player.on(voice.AudioPlayerStatus.Idle, () => {
                done({ ok: true, reason: '再生が完了しました。' });
            });

            stream.on('error', err => {
                console.error('[radioTaiso] 音源の読み込みに失敗:', err);
                done({ ok: false, reason: `音源の読み込みに失敗: ${err.message}` });
            });
        });

        const resource = voice.createAudioResource(stream, {
            inputType: getInputType(voice, audioPath)
        });

        currentConnection.subscribe(player);
        player.play(resource);

        const outcome = await finished;

        player.stop(true);

        return outcome;
    } catch (err) {
        console.error('[radioTaiso] 再生処理でエラー:', err);

        if (player) {
            try {
                player.stop(true);
            } catch {
                // 停止できなくても後続の切断は行う
            }
        }

        return { ok: false, reason: err.message };
    }
}

/**
 * 再生終了後: 参加者を確定してポイント付与・参加日記録・一覧投稿を行う
 */
async function finishMorningSession(client, data, saveData, { played, reason = '' }) {
    const radio = ensureRadioData(data);
    const session = radio.session;

    if (!session) {
        disconnectVoice();
        return;
    }

    const voiceChannel = await fetchVoiceChannel(client);
    collectCurrentMembers(voiceChannel, session);

    disconnectVoice();

    const participants = [...new Set(session.participants)];
    const date = session.date;

    for (const participantId of participants) {
        ensureUser(data, participantId);

        if (!radio.attendance[participantId]) radio.attendance[participantId] = [];

        if (!radio.attendance[participantId].includes(date)) {
            radio.attendance[participantId].push(date);
        }

        addPoints(data, participantId, DAILY_POINT, { addToLevel: false });

        addPointLog(data, {
            userId: participantId,
            type: 'radio',
            amount: DAILY_POINT,
            detail: `ラジオ体操 ${date}`
        });
    }

    radio.session = null;
    saveData(data);

    const channel = await fetchAnnounceChannel(client);
    if (!channel) return;

    const lines = [`**【本日のラジオ体操参加者】** (${date})`];

    if (participants.length === 0) {
        lines.push('本日の参加者はいませんでした。');
    } else {
        participants.forEach((participantId, index) => {
            const days = (radio.attendance[participantId] || []).length;
            lines.push(`${index + 1}. <@${participantId}>（通算 ${days}日目）`);
        });

        lines.push('');
        lines.push(`参加者 ${participants.length} 名に ${DAILY_POINT}pt を付与しました。`);
    }

    if (!played) {
        lines.push('※音声の再生に失敗したため、記録のみ行いました。');
        if (reason) lines.push(`（原因: ${reason}）`);
    }

    try {
        await channel.send({
            content: lines.join('\n'),
            allowedMentions: { parse: [] }
        });
    } catch (err) {
        console.error('[radioTaiso] 参加者一覧の投稿に失敗しました:', err.message);
    }
}

/**
 * 毎分呼ばれるスケジューラ本体
 */
async function handleRadioTaisoSchedule(client, loadData, saveData) {
    const data = loadData();
    const radio = ensureRadioData(data);

    if (!radio.active) return;

    const today = getJstDateString();
    const { hour, minute } = getJstHourMinute();
    const session = radio.session;

    // 日付をまたいで残ってしまったセッションは破棄する
    if (session && session.date !== today) {
        radio.session = null;
        disconnectVoice();
        saveData(data);
        return;
    }

    // 8:50ちょうどの1回だけを狙うと、setIntervalのズレや再起動で丸ごと空振りする。
    // 「8:50以降 9:00未満」かつ「その日まだ実施していない」なら開始する。
    const nowMinutes = hour * 60 + minute;
    const joinMinutes = RADIO_JOIN_HOUR * 60 + RADIO_JOIN_MINUTE;
    const playMinutes = RADIO_PLAY_HOUR * 60 + RADIO_PLAY_MINUTE;

    if (
        !session &&
        nowMinutes >= joinMinutes &&
        nowMinutes < playMinutes &&
        radio.lastSessionDate !== today
    ) {
        await startMorningSession(client, data, saveData, today);
        return;
    }

    if (!session) return;

    if (session.phase === 'collecting' && nowMinutes >= playMinutes) {
        await playRadioTaiso(client, data, saveData);
        return;
    }

    // 収集中は、毎分VCの在室者を拾って取りこぼしを防ぐ
    if (session.phase === 'collecting') {
        const voiceChannel = await fetchVoiceChannel(client);

        if (collectCurrentMembers(voiceChannel, session)) {
            saveData(data);
        }

        return;
    }

    // 再生中のまま長時間残っている場合（再起動などで再生Promiseが失われたとき）の保険
    if (
        session.phase === 'playing' &&
        session.startedAt &&
        Date.now() - session.startedAt > MAX_SESSION_MS
    ) {
        await finishMorningSession(client, data, saveData, { played: false });
    }
}

/**
 * voiceStateUpdate から呼ぶ。収集中に対象VCへ入ってきた人を記録する。
 */
function handleRadioVoiceStateUpdate(newState, loadData, saveData) {
    if (!newState || !newState.member || newState.member.user.bot) return;
    if (newState.channelId !== RADIO_VC_ID) return;

    const data = loadData();
    const radio = ensureRadioData(data);

    if (!radio.active || !radio.session) return;
    if (radio.session.phase === 'finished') return;
    if (radio.session.participants.includes(newState.member.id)) return;

    radio.session.participants.push(newState.member.id);
    saveData(data);
}

/**
 * /radio-start: 約1ヶ月のラジオ体操イベントを開始する
 */
function startRadioEvent(data, saveData) {
    const radio = ensureRadioData(data);

    if (radio.active) {
        return {
            ok: false,
            message: `ラジオ体操イベントはすでに開催中です（開始日: ${radio.startedDate}）。`
        };
    }

    radio.active = true;
    radio.startedDate = getJstDateString();
    radio.lastSessionDate = null;
    radio.attendance = {};
    radio.session = null;

    saveData(data);

    return {
        ok: true,
        message:
            `ラジオ体操イベントを開始しました（${radio.startedDate}〜）。\n` +
            `毎朝 ${RADIO_JOIN_HOUR}:${String(RADIO_JOIN_MINUTE).padStart(2, '0')} に <#${RADIO_VC_ID}> へ参加し、` +
            `${RADIO_PLAY_HOUR}:${String(RADIO_PLAY_MINUTE).padStart(2, '0')} からラジオ体操第一を再生します。\n` +
            `参加者には毎日 ${DAILY_POINT}pt、終了時の1位には ${TOP_BONUS_POINT}pt を付与します。`
    };
}

/**
 * /radio-end: イベントを終了し、参加日数ランキングを発表する
 */
async function endRadioEvent(client, data, saveData) {
    const radio = ensureRadioData(data);

    if (!radio.active) {
        return {
            ok: false,
            message: '現在、ラジオ体操イベントは開催されていません。'
        };
    }

    const ranking = Object.entries(radio.attendance)
        .map(([userId, dates]) => ({ userId, days: (dates || []).length }))
        .filter(entry => entry.days > 0)
        .sort((a, b) => b.days - a.days);

    const lines = [
        '**【ラジオ体操 最終結果】**',
        `期間: ${radio.startedDate} 〜 ${getJstDateString()}`,
        ''
    ];

    if (ranking.length === 0) {
        lines.push('参加記録がありませんでした。');
    } else {
        const topDays = ranking[0].days;

        ranking.forEach((entry, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
            lines.push(`${medal} <@${entry.userId}> — ${entry.days}日`);
        });

        const winners = ranking.filter(entry => entry.days === topDays);

        for (const winner of winners) {
            ensureUser(data, winner.userId);

            addPoints(data, winner.userId, TOP_BONUS_POINT, { addToLevel: false });

            addPointLog(data, {
                userId: winner.userId,
                type: 'radio-bonus',
                amount: TOP_BONUS_POINT,
                detail: `ラジオ体操1位 ${winner.days}日`
            });
        }

        lines.push('');
        lines.push(
            `🎉 1位 ${winners.map(w => `<@${w.userId}>`).join(' ')} に ${TOP_BONUS_POINT}pt を付与しました！`
        );
    }

    radio.active = false;
    radio.session = null;
    radio.lastSessionDate = null;

    disconnectVoice();
    saveData(data);

    const content = lines.join('\n');
    const channel = await fetchAnnounceChannel(client);

    if (channel) {
        try {
            await channel.send({ content, allowedMentions: { parse: [] } });
        } catch (err) {
            console.error('[radioTaiso] 最終結果の投稿に失敗しました:', err.message);
        }
    }

    return { ok: true, message: content };
}

/**
 * /radio-test: 参加記録に影響を与えずに、その場で音声再生だけを試す
 */
async function testRadioAudio(client, data) {
    const radio = ensureRadioData(data);

    if (radio.session) {
        return {
            ok: false,
            message: '本日のラジオ体操セッションの進行中です。終了後に試してください。'
        };
    }

    const setup = describeAudioSetup();

    if (!setup.ok) {
        return { ok: false, message: `再生できません。\n${setup.reason}` };
    }

    const voiceChannel = await fetchVoiceChannel(client);
    const result = await playAudioInChannel(voiceChannel, client);

    disconnectVoice();

    return {
        ok: result.ok,
        message: result.ok
            ? `再生に成功しました。\n${setup.reason}`
            : `再生に失敗しました。\n原因: ${result.reason}`
    };
}

/**
 * 起動時に前提条件を確認してログに出す（問題があっても起動は止めない）
 */
function logRadioSetup(client = null) {
    const setup = describeAudioSetup();

    if (setup.ok) {
        console.log(`[radioTaiso] 再生準備OK / ${setup.reason}`);
    } else {
        console.warn(`[radioTaiso] 再生できない状態です: ${setup.reason}`);
    }

    if (client && client.options && client.options.intents) {
        const hasIntent = client.options.intents.has(GatewayIntentBits.GuildVoiceStates);

        if (!hasIntent) {
            console.error(
                '[radioTaiso] GatewayIntentBits.GuildVoiceStates が有効になっていません。' +
                'ボイス接続は必ず失敗します。'
            );
        }
    }
}

module.exports = {
    handleRadioTaisoSchedule,
    testRadioAudio,
    logRadioSetup,
    describeAudioSetup,
    handleRadioVoiceStateUpdate,
    startRadioEvent,
    endRadioEvent,
    RADIO_VC_ID,
    RADIO_ANNOUNCE_CHANNEL_ID,
    DAILY_POINT,
    TOP_BONUS_POINT
};
