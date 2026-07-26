'use strict';

/**
 * Sky（星を紡ぐ子どもたち）の「今日の破片」計算モジュール
 * 元ネタ: Google Apps Script (createShardEventsOneMonth) のロジックをそのまま移植。
 *
 * 元コードはイベントの「開始が0〜16時台なら翌日扱いにする」等の補正をした上で
 * カレンダーへ登録するためのものだったが、ここでは「その日の情報を文字列として出す」
 * ことだけが目的なので、日付をまたぐ補正ロジックはそのまま流用しつつ、
 * 表示は「時刻はそのまま(HH:MM-HH:MM)、日またぎは翌日表記」で行う。
 */

// A. 地方サイクル（毎月1日起点）
const REGIONS = ['草原', '雨林', '峡谷', '捨てられた地', '書庫'];

// B. グループサイクル（毎月1日起点）
const GROUP_CYCLE = [2, 1, 3, 0, 4, 1, 2, 0, 3, 1, 4, 0];

// グループ定義（GASコードそのまま）
const GROUPS = {
  0: {
    name: '黒の破片',
    skipDays: [0, 6], // 日, 土
    places: {
      草原: { place: '蝶々の住処', reward: '200' },
      雨林: { place: '雨林の小川', reward: '200' },
      峡谷: { place: 'アイスリンク', reward: '200' },
      捨てられた地: { place: '倒壊した祠', reward: '200' },
      書庫: { place: '星月夜の砂漠', reward: '200' },
    },
    times: ['17:58-21:58', '01:58-05:58', '09:58-13:58'],
  },
  1: {
    name: '黒の破片',
    skipDays: [0, 1], // 日, 月
    places: {
      草原: { place: '草原の村', reward: '200' },
      雨林: { place: '雨林の墓場', reward: '200' },
      峡谷: { place: 'アイスリンク', reward: '200' },
      捨てられた地: { place: '戦場', reward: '200' },
      書庫: { place: '星月夜の砂漠', reward: '200' },
    },
    times: ['18:18-22:18', '02:18-06:18', '10:18-14:18'],
  },
  2: {
    name: '赤の破片',
    skipDays: [1, 2], // 月, 火
    places: {
      草原: { place: '草原の洞窟', reward: '星のキャンドル2.0本' },
      雨林: { place: '雨林の端', reward: '星のキャンドル2.5本' },
      峡谷: { place: '夢海の街', reward: '星のキャンドル2.5本' },
      捨てられた地: { place: '暗黒竜一匹エリア', reward: '星のキャンドル2.0本' },
      書庫: { place: '海月の入り江', reward: '星のキャンドル3.5本' },
    },
    times: ['23:48-03:48', '05:48-09:48', '11:48-15:48'],
  },
  3: {
    name: '赤の破片',
    skipDays: [2, 3], // 火, 水
    places: {
      草原: { place: '鳥の塔', reward: '星のキャンドル2.5本' },
      雨林: { place: 'ツリーハウス', reward: '星のキャンドル3.5本' },
      峡谷: { place: '夢海の街', reward: '星のキャンドル2.5本' },
      捨てられた地: { place: '座礁船', reward: '星のキャンドル2.5本' },
      書庫: { place: '海月の入り江', reward: '星のキャンドル3.5本' },
    },
    times: ['18:28-22:28', '00:28-04:28', '06:28-10:28'],
  },
  4: {
    name: '赤の破片',
    skipDays: [3, 4], // 水, 木
    places: {
      草原: { place: '楽園の島々', reward: '星のキャンドル3.5本' },
      雨林: { place: '晴れ間', reward: '星のキャンドル3.5本' },
      峡谷: { place: '隠者の峠', reward: '星のキャンドル3.5本' },
      捨てられた地: { place: '忘れられた方舟', reward: '星のキャンドル3.5本' },
      書庫: { place: '海月の入り江', reward: '星のキャンドル3.5本' },
    },
    times: ['19:38-23:38', '01:38-05:38', '07:38-11:38'],
  },
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 指定した日付(そのローカル日付の 0:00 を基準)における
 * 「月初からの経過日数インデックス」を計算する。
 * GASの `Math.floor((d - base) / ONE_DAY)` と同じロジック。
 */
function getDayIndex(date) {
  const base = new Date(date.getFullYear(), date.getMonth(), 1);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((target - base) / ONE_DAY_MS);
}

/**
 * "HH:MM" 文字列から Date オブジェクトを作る（baseDateと同じ年月日、指定時刻）
 */
function buildDate(baseDate, timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * 時間帯文字列 "HH:MM-HH:MM" を、GASコードと同じ補正ルールで
 * 「表示用の開始/終了ラベル」に変換する。
 * ルール（GASそのまま）:
 *   - 開始が 0〜16 時台 → 翌日扱い
 *   - 終了 <= 開始 なら 終了は翌日扱い（日またぎ, 例: 23:48-03:48）
 * 戻り値: { startLabel, endLabel } 例: { startLabel: '17:58', endLabel: '21:58' }
 *         日をまたぐ場合は endLabel に "(翌日)" を付与
 */
function formatTimeRange(baseDate, timeStr) {
  const [startStr, endStr] = timeStr.split('-');

  let start = buildDate(baseDate, startStr);
  let end = buildDate(baseDate, endStr);
  let startIsNextDay = false;

  // 開始が 0〜16 時台 → 翌日扱い
  if (start.getHours() < 17) {
    start = new Date(start.getTime() + ONE_DAY_MS);
    end = new Date(end.getTime() + ONE_DAY_MS);
    startIsNextDay = true;
  }

  // 終了時刻が開始より前なら翌日に補正（例: 23:48-03:48）
  let endIsNextDay = false;
  if (end <= start) {
    end = new Date(end.getTime() + ONE_DAY_MS);
    endIsNextDay = true;
  }

  const startLabel = startIsNextDay ? `翌日${startStr}` : startStr;
  const endLabel = endIsNextDay || startIsNextDay ? `翌日${endStr}` : endStr;

  return `${startLabel}-${endLabel}`;
}

/**
 * 指定日の破片情報を計算する。
 * @param {Date} date 判定したい日（ローカル日付基準、時刻は無視）
 * @returns {{
 *   type: '黒'|'赤'|'なし',
 *   region: string|null,
 *   place: string|null,
 *   reward: string|null,
 *   times: string[]|null   // formatTimeRange済みの文字列配列
 * }}
 */
function getShardInfo(date = new Date()) {
  const dayIndex = getDayIndex(date);
  const region = REGIONS[((dayIndex % REGIONS.length) + REGIONS.length) % REGIONS.length];
  const groupNum = GROUP_CYCLE[((dayIndex % GROUP_CYCLE.length) + GROUP_CYCLE.length) % GROUP_CYCLE.length];
  const group = GROUPS[groupNum];

  const weekday = date.getDay();
  if (group.skipDays.includes(weekday)) {
    return { type: 'なし', region: null, place: null, reward: null, times: null };
  }

  const placeInfo = group.places[region];
  const times = group.times.map((t) => formatTimeRange(date, t));
  const type = group.name.startsWith('黒') ? '黒' : '赤';

  return {
    type,
    region,
    place: placeInfo.place,
    reward: placeInfo.reward,
    times,
  };
}

/**
 * "HH:MM" 文字列に分を加算し、24時間で繰り上げた "HH:MM" を返す（日付情報は持たない、時刻のみの単純計算）
 */
function addMinutesToTimeStr(timeStr, minutesToAdd) {
  const [h, m] = timeStr.split(':').map(Number);
  let total = (h * 60 + m + minutesToAdd) % (24 * 60);
  if (total < 0) total += 24 * 60;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * 指定日の各セッション（時間帯）について、
 * 「開始時刻・終了時刻がその日のJSTの何時何分にあたるか」を
 * "HH:MM" 文字列(日付をまたぐかどうかの情報も含む)として返す。
 *
 * これは formatTimeRange の日またぎ判定ロジックと同じ考え方を使うが、
 * 目的が異なる（表示用ラベルではなく、「毎分ポーリングして時刻が一致したら
 * 通知を送る」ための判定材料が欲しい）ため、開始・終了それぞれについて
 * 「その時刻が baseDate 当日なのか、翌日なのか」を明示的なフラグで返す。
 *
 * @param {Date} date 判定したい日（ローカル日付基準）
 * @returns {Array<{
 *   index: number,           // 何番目のセッションか (0-2)
 *   startTimeStr: string,    // "HH:MM" (時刻のみ)
 *   startIsNextDay: boolean, // 開始がbaseDateの翌日かどうか
 *   endTimeStr: string,      // "HH:MM" (時刻のみ)
 *   endIsNextDay: boolean,   // 終了がbaseDateの翌日かどうか
 * }> | null}  「なし」の日は null
 */
function getShardSessions(date = new Date()) {
  const dayIndex = getDayIndex(date);
  const groupNum = GROUP_CYCLE[((dayIndex % GROUP_CYCLE.length) + GROUP_CYCLE.length) % GROUP_CYCLE.length];
  const group = GROUPS[groupNum];

  const weekday = date.getDay();
  if (group.skipDays.includes(weekday)) {
    return null;
  }

  return group.times.map((t, index) => {
    const [startStr, endStr] = t.split('-');
    const toMinutes = (s) => {
      const [h, m] = s.split(':').map(Number);
      return h * 60 + m;
    };
    const startTotalMin = toMinutes(startStr);
    const endTotalMin = toMinutes(endStr);

    // formatTimeRangeと同じ判定ルール（GAS準拠）:
    // ・開始が0〜16時台 → baseDateの翌日扱い（+1日）
    // ・終了 <= 開始 → 終了はさらに+1日
    const startDaysOffset = startTotalMin < 17 * 60 ? 1 : 0;
    const endDaysOffset = startDaysOffset + (endTotalMin <= startTotalMin ? 1 : 0);

    return {
      index,
      startTimeStr: startStr,
      startDaysOffset, // baseDateから何日後が開始日か（0=当日, 1=翌日）
      endTimeStr: endStr,
      endDaysOffset, // baseDateから何日後が終了日か
    };
  });
}

module.exports = {
  getShardInfo,
  getShardSessions,
  addMinutesToTimeStr,
  REGIONS,
  GROUP_CYCLE,
  GROUPS,
};
