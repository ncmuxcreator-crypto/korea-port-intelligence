import * as sample from './sample.js';

export const collectors = [
  { name: 'sample', run: sample.collect }
  // Add later:
  // { name: 'busan', run: busan.collect },
  // { name: 'yeosu', run: yeosu.collect },
  // { name: 'ulsan', run: ulsan.collect }
];
