// Keep the Korean headwords themselves as stable identifiers for saved drafts
// and shared links. The lists below are the only values a rule or a condition
// may take, so a link can be checked against them.
const gulgamWords = {
  nouns: [
    '우산', '편지', '단추', '열쇠', '연필', '수첩', '봉투', '거울', '시계', '성냥',
    '컵', '안경', '모자', '구두', '장갑', '리본', '주전자', '책갈피', '도장', '바늘',
    '골목', '정류장', '서점', '옥상', '계단', '세탁소', '우체국', '기차역', '마당', '창고',
    '횡단보도', '놀이터', '시장', '항구', '다락방', '부엌', '창가', '복도', '대합실', '모퉁이',
    '귤', '복숭아', '자두', '감자', '사과', '보리차', '식빵', '사탕', '달걀', '후추',
    '도시락', '두부', '밤', '대추', '옥수수', '커피', '홍차', '우유', '수박', '찐빵', '치킨',
    '바람', '안개', '파도', '갈대', '돌멩이', '소나무', '물웅덩이', '이끼', '노을', '눈송이',
    '소나기', '고양이', '참새', '나비', '달팽이', '그늘', '씨앗', '낙엽', '숲', '냇물',
    '이웃', '친구', '누나', '동생', '손님', '선생님', '점원', '화가', '우체부', '여행자',
    '약속', '기억', '소문', '침묵', '비밀', '꿈', '방학', '이별', '휴일', '기척',
    '첫눈', '새벽', '마중', '농담', '생일', '여름', '낮잠', '작별', '부탁', '대답'
  ],
  // Rules the app judges: a character limit, a time limit, or a banned word.
  lengths: [100, 150, 200, 300],
  minutes: [3, 5, 10],
  banned: ['그리고', '그래서', '하지만', '너무', '정말', '진짜', '갑자기', '마음', '행복', '사랑'],
  // Conditions are printed on the receipt only; the reader judges them.
  conditions: {
    pov: ['1인칭', '2인칭', '전지적'],
    mood: ['공포', '유머', '쓸쓸함', '설렘', '분노', '평온', '미스터리', '몽환'],
    form: ['대화문', '장면 묘사']
  }
};
