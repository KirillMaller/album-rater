// Проверка честности алгоритма "Колеса аукциона" из db/migrations/012_wheel_sessions.sql
// (функция lock_wheel_session): key = random()^(1/вес), сортировка по убыванию,
// rank 0 = победитель. Симулирует много розыгрышей и сверяет наблюдаемую % победы с теоретической.

const PARTICIPANTS = [
  { title: 'A', amount: 100 },
  { title: 'B', amount: 300 },
  { title: 'C', amount: 500 },
  { title: 'D', amount: 1000 },
  { title: 'E', amount: 2000 },
];

const SIMULATIONS = 200_000;
const DEVIATION_THRESHOLD_PP = 1.0; // порог "проблема", в процентных пунктах

const totalWeight = PARTICIPANTS.reduce((sum, p) => sum + p.amount, 0);

// Счётчики
const winCounts = PARTICIPANTS.map(() => 0);
const rankSums = PARTICIPANTS.map(() => 0);

for (let sim = 0; sim < SIMULATIONS; sim++) {
  // 1. Считаем key_i = random()^(1/w_i) для каждого участника
  const keyed = PARTICIPANTS.map((p, idx) => ({
    idx,
    key: Math.random() ** (1 / p.amount),
  }));

  // 2. Сортируем по убыванию key. rank 0 = наибольший key = победитель.
  keyed.sort((a, b) => b.key - a.key);

  keyed.forEach((entry, rank) => {
    rankSums[entry.idx] += rank;
    if (rank === 0) {
      winCounts[entry.idx]++;
    }
  });
}

// --- Таблица результатов ---
console.log(`Симуляций: ${SIMULATIONS.toLocaleString('ru-RU')}`);
console.log(`Сумма весов: ${totalWeight}`);
console.log('');

const header = [
  'Участник',
  'Вес',
  'Доля веса %',
  'Теор. % победы',
  'Набл. % победы',
  'Отклонение (пп)',
  'Ср. rank',
].map((h) => h.padEnd(16)).join('');
console.log(header);
console.log('-'.repeat(header.length));

let maxDeviation = 0;

const rows = PARTICIPANTS.map((p, idx) => {
  const shareOfWeight = (p.amount / totalWeight) * 100;
  const theoretical = shareOfWeight; // теоретическая вероятность победы = доля веса
  const observed = (winCounts[idx] / SIMULATIONS) * 100;
  const deviation = observed - theoretical;
  const avgRank = rankSums[idx] / SIMULATIONS;

  maxDeviation = Math.max(maxDeviation, Math.abs(deviation));

  return { title: p.title, amount: p.amount, shareOfWeight, theoretical, observed, deviation, avgRank };
});

for (const r of rows) {
  console.log(
    [
      r.title,
      String(r.amount),
      r.shareOfWeight.toFixed(2) + '%',
      r.theoretical.toFixed(2) + '%',
      r.observed.toFixed(2) + '%',
      (r.deviation >= 0 ? '+' : '') + r.deviation.toFixed(3),
      r.avgRank.toFixed(3),
    ]
      .map((c) => c.padEnd(16))
      .join('')
  );
}

console.log('');

// --- Проверка корреляции: больший вес -> меньший средний rank (дольше в игре / чаще побеждает) ---
console.log('Проверка: больший вес должен давать МЕНЬШИЙ средний rank (дольше в игре).');
const sortedByWeightAsc = [...rows].sort((a, b) => a.amount - b.amount);
let monotonic = true;
for (let i = 1; i < sortedByWeightAsc.length; i++) {
  if (sortedByWeightAsc[i].avgRank > sortedByWeightAsc[i - 1].avgRank) {
    monotonic = false;
    break;
  }
}
console.log(
  sortedByWeightAsc
    .map((r) => `${r.title}(вес ${r.amount}): ср.rank=${r.avgRank.toFixed(3)}`)
    .join('  ->  ')
);
console.log(
  monotonic
    ? '✅ Корреляция верная: чем больше вес, тем меньше средний rank (дольше в игре / чаще побеждает).'
    : '❌ ПРОБЛЕМА: средний rank не убывает монотонно с ростом веса — порядок нарушен.'
);
console.log('');

// --- Итоговый вердикт ---
if (maxDeviation <= DEVIATION_THRESHOLD_PP && monotonic) {
  console.log(
    `✅ Алгоритм честный: вероятность победы пропорциональна сумме, максимальное отклонение ${maxDeviation.toFixed(
      3
    )} пп (порог ${DEVIATION_THRESHOLD_PP} пп при ${SIMULATIONS.toLocaleString('ru-RU')} симуляциях).`
  );
} else {
  console.log(
    `❌ ПРОБЛЕМА: максимальное отклонение ${maxDeviation.toFixed(
      3
    )} пп превышает порог ${DEVIATION_THRESHOLD_PP} пп, либо нарушена корреляция веса и среднего rank.`
  );
}
