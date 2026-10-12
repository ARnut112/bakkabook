import fs from 'node:fs';
fs.mkdirSync('assets/covers', { recursive: true });
const covers = [
  [
    'bloom',
    '#244b42',
    '#f4e9bf',
    ['ในวันที่ดอกไม้', 'ผลิบาน'],
    'THE SEASON OF BECOMING',
    'ณิชา วรรณศิลป์',
    'flower',
  ],
  [
    'joy',
    '#e8ba64',
    '#303e37',
    ['พื้นที่เล็ก ๆ', 'ของความสุข'],
    'A LITTLE ROOM FOR JOY',
    'พิมพ์ใจ',
    'sun',
  ],
  [
    'seeing',
    '#eae5db',
    '#254c61',
    ['ศิลปะของ', 'การมองเห็น'],
    'THE ART OF SEEING',
    'กานต์ ดีไซน์',
    'abstract',
  ],
  [
    'slowly',
    '#879e8b',
    '#fff7dd',
    ['ออกเดินทาง', 'อย่างช้า ๆ'],
    'SOMEWHERE, SLOWLY',
    'ธารา ระหว่างทาง',
    'mountain',
  ],
  [
    'moon',
    '#283d59',
    '#f3deab',
    ['จดหมายถึง', 'พระจันทร์'],
    'LETTERS TO THE MOON',
    'มนัสวี',
    'moon',
  ],
  [
    'sunday',
    '#ca7755',
    '#fff1d4',
    ['กาแฟ หนังสือ', 'และวันอาทิตย์'],
    'A SUNDAY KIND OF LIFE',
    'อุ่นไอ',
    'coffee',
  ],
  [
    'grow',
    '#c0c99a',
    '#345144',
    ['เติบโตใน', 'แบบของเรา'],
    'GROW AT YOUR OWN PACE',
    'รินรดา',
    'plant',
  ],
  [
    'lines',
    '#e8a68e',
    '#733d3c',
    ['สีสันระหว่าง', 'บรรทัด'],
    'BETWEEN THE LINES',
    'สตูดิโอวันวาด',
    'lines',
  ],
  ['home', '#d8c4a3', '#4c5545', ['บ้านที่', 'มีเราอยู่'], 'A PLACE TO BELONG', 'ลลิน', 'home'],
  [
    'town',
    '#65918e',
    '#fcf0d5',
    ['เมืองเล็ก', 'ความทรงจำใหญ่'],
    'LITTLE TOWNS, BIG MEMORIES',
    'ธารา ระหว่างทาง',
    'town',
  ],
  [
    'rain',
    '#98afc5',
    '#293e58',
    ['ระหว่างฝน', 'กับสายรุ้ง'],
    'AFTER THE RAIN',
    'ณิชา วรรณศิลป์',
    'rain',
  ],
  [
    'gentle',
    '#e7c2b5',
    '#8b4f48',
    ['วันนี้ขอใจดี', 'กับตัวเอง'],
    'BE GENTLE WITH YOURSELF',
    'พิมพ์ใจ',
    'heart',
  ],
];
const arts = {
  flower:
    '<path d="M160 362q-25-72 2-150M160 313q-50 4-65-43 50-5 65 43M158 283q43-36 65-9-22 28-65 9" fill="none" stroke="#b7c5a2" stroke-width="4"/><g fill="#e9bf73"><ellipse cx="162" cy="218" rx="18" ry="39"/><ellipse cx="162" cy="218" rx="18" ry="39" transform="rotate(60 162 218)"/><ellipse cx="162" cy="218" rx="18" ry="39" transform="rotate(120 162 218)"/></g><circle cx="162" cy="218" r="14" fill="#d87b54"/><g fill="#f3e5bd"><circle cx="83" cy="215" r="3"/><circle cx="234" cy="323" r="3"/><circle cx="221" cy="198" r="2"/></g>',
  sun: '<circle cx="160" cy="258" r="64" fill="#e4a14e"/><path d="M78 354V262a82 82 0 0 1 164 0v92" fill="none" stroke="#f8e9bd" stroke-width="15"/><path d="M93 350h133v-56H93z" fill="#8f9c79"/><path d="M117 294v56m42-56v56m43-56v56" stroke="#e8ba64" stroke-width="5"/><circle cx="160" cy="263" r="26" fill="#fff0c0"/>',
  abstract:
    '<circle cx="121" cy="248" r="65" fill="#ca684d"/><rect x="152" y="230" width="86" height="124" fill="#345769"/><path d="M70 350V250h90z" fill="#d9b76e"/><circle cx="206" cy="210" r="25" fill="#7c9883"/><path d="M70 377h170" stroke="#345769" stroke-width="2"/>',
  mountain:
    '<circle cx="213" cy="220" r="35" fill="#f1d7a2"/><path d="M0 335l104-132 91 132z" fill="#526f65"/><path d="M91 369l123-128 106 128v54H0v-54" fill="#38594d"/><path d="M91 380q126-80 98-19t-30 43" fill="none" stroke="#e1caaa" stroke-width="9"/><path d="M95 215l-22 27 31-12 21 8z" fill="#e4e5cd"/>',
  moon: '<circle cx="164" cy="262" r="68" fill="#f3deab"/><circle cx="196" cy="239" r="59" fill="#283d59"/><g fill="#f3deab"><circle cx="68" cy="203" r="3"/><circle cx="245" cy="283" r="2"/><circle cx="92" cy="350" r="2"/><path d="M221 183v18m-9-9h18M70 278v16m-8-8h16" stroke="#f3deab" stroke-width="2"/></g>',
  coffee:
    '<ellipse cx="156" cy="341" rx="83" ry="17" fill="#a65f45"/><path d="M90 247h112v59a36 36 0 0 1-36 36h-40a36 36 0 0 1-36-36z" fill="#f6e4bd"/><path d="M202 258h12a24 24 0 0 1 0 48h-12" stroke="#f6e4bd" stroke-width="10" fill="none"/><ellipse cx="146" cy="247" rx="56" ry="12" fill="#744d39"/><path d="M128 222q-14-14 0-26m30 25q-14-14 0-26" stroke="#f6e4bd" stroke-width="3" fill="none"/>',
  plant:
    '<path d="M126 307h70l-14 56h-42z" fill="#a86e50"/><path d="M161 307v-90" stroke="#345144" stroke-width="5"/><path d="M160 274q-78 0-54-49 53-8 54 49M162 242q59 5 57-43-59-1-57 43M160 299q67 1 62-42-60-3-62 42" fill="#52795b"/>',
  lines:
    '<path d="M75 220q85-75 170 0M75 244q85-75 170 0M75 268q85-75 170 0M75 292q85-75 170 0M75 316q85-75 170 0M75 340q85-75 170 0" stroke="#733d3c" stroke-width="9" fill="none"/><circle cx="221" cy="343" r="29" fill="#e4c876"/>',
  home: '<path d="M77 273l83-76 83 76v90H77z" fill="#f4e8d0"/><path d="M67 277l93-86 93 86" stroke="#8c684d" stroke-width="11" fill="none"/><rect x="139" y="289" width="42" height="74" rx="21" fill="#7d9276"/><path d="M96 286h27v29H96zM198 286h27v29h-27z" fill="#ddb571"/>',
  town: '<path d="M39 290l45-38 45 38v80H39z" fill="#e9d4a9"/><path d="M112 250l50-42 50 42v120H112z" fill="#d18a69"/><path d="M198 290l40-35 40 35v80h-80z" fill="#bfcaa4"/><path d="M61 313h17v24H61zM94 313h17v24H94zM137 269h18v26h-18zM174 269h18v26h-18zM218 307h18v27h-18z" fill="#416766"/><path d="M150 321h26v49h-26z" fill="#fcf0d5"/>',
  rain: '<path d="M81 334v-65a79 79 0 0 1 158 0v65" fill="none" stroke="#d7977d" stroke-width="16"/><path d="M104 334v-65a56 56 0 0 1 112 0v65" fill="none" stroke="#e9cf98" stroke-width="16"/><path d="M127 334v-65a33 33 0 0 1 66 0v65" fill="none" stroke="#628c80" stroke-width="16"/>',
  heart:
    '<path d="M160 342L84 269c-50-62 53-106 76-36 23-70 126-26 76 36z" fill="#b36b60"/><path d="M143 292q17-25 35 0" fill="none" stroke="#f3dfcb" stroke-width="3"/><g fill="#f3dfcb"><circle cx="130" cy="267" r="4"/><circle cx="190" cy="267" r="4"/></g>',
};
for (const [slug, bg, fg, title, english, author, art] of covers) {
  const base = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="460" viewBox="0 0 320 460"><rect width="320" height="460" fill="${bg}"/><path d="M9 0v460" stroke="#000" opacity=".13" stroke-width="3"/><rect x="18" y="18" width="284" height="424" fill="none" stroke="${fg}" opacity=".28"/><g fill="${fg}" text-anchor="middle" font-family="Tahoma, sans-serif">`;
  fs.writeFileSync(
    `assets/covers/${slug}.svg`,
    base +
      `<text x="160" y="45" font-size="8" letter-spacing="3">BAKKA EDITIONS</text><text x="160" y="105" font-size="27" font-weight="bold">${title[0]}</text><text x="160" y="147" font-size="27" font-weight="bold">${title[1]}</text><text x="160" y="171" font-size="7" letter-spacing="1.5">${english}</text></g>${arts[art]}<text x="160" y="409" fill="${fg}" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="12">${author}</text></svg>`,
  );
  fs.writeFileSync(
    `assets/covers/${slug}-back.svg`,
    base +
      `<text x="160" y="61" font-size="11" letter-spacing="2">BAKKA EDITIONS</text><text x="160" y="133" font-size="18">เรื่องราวดี ๆ</text><text x="160" y="169" font-size="18">กำลังรอคุณอยู่</text><text x="160" y="211" font-size="11">อ่านช้า ๆ แล้วพบกันระหว่างบรรทัด</text><text x="160" y="265" font-size="12">${title.join('')}</text><text x="160" y="297" font-size="11">${author}</text><text x="160" y="376" font-size="10">ภาพปกและหนังสือตัวอย่าง</text><text x="160" y="403" font-size="16" font-family="Georgia">bakkabook.</text></g></svg>`,
  );
}
console.log('Created 24 original book cover illustrations.');
