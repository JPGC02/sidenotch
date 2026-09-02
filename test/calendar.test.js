const assert = require('assert');
const { parseICS, occurrences, Calendar } = require('../src/calendar');
const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a1
DTSTART:20260902T140000Z
DTEND:20260902T150000Z
SUMMARY:Reunião com a
  equipe
LOCATION:Sala 2
END:VEVENT
BEGIN:VEVENT
UID:a2
DTSTART;VALUE=DATE:20260903
DTEND;VALUE=DATE:20260904
SUMMARY:Feriado
END:VEVENT
BEGIN:VEVENT
UID:a3
DTSTART;TZID=America/Sao_Paulo:20260901T090000
DTEND;TZID=America/Sao_Paulo:20260901T093000
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6
SUMMARY:Daily
END:VEVENT
BEGIN:VEVENT
UID:a4
DTSTART:20260901T120000Z
DTEND:20260901T123000Z
RRULE:FREQ=DAILY;UNTIL=20260905T000000Z
EXDATE:20260903T120000Z
SUMMARY:Almoço
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;
const evs = parseICS(ics);
assert.equal(evs.length, 4); assert.equal(evs[0].SUMMARY, 'Reunião com a equipe'); assert.equal(evs[1].DTSTART.allDay, true);
const from = new Date(2026, 8, 1).getTime(), to = new Date(2026, 8, 30).getTime();
assert.equal(occurrences(evs[0], from, to).length, 1);
const weekly = occurrences(evs[2], from, to); assert.equal(weekly.length, 6); assert.ok([1, 3].includes(new Date(weekly[0].start).getDay()), 'seg ou qua');
const daily = occurrences(evs[3], from, to); assert.equal(daily.length, 3, 'DAILY até 05/09 menos EXDATE 03/09 = 1,2,4');
console.log('✓ parse + recorrência');
// Calendar.state com fetch simulado
global.fetch = async () => ({ ok: true, text: async () => ics });
(async () => {
  const c = new Calendar();
  const st = await c.refresh([{ name: 'Teste', url: 'https://x/y.ics' }]);
  assert.equal(st.days.length, 8); assert.ok(st.days.some((d) => d.isToday));
  assert.ok(!c.events.some((e) => e.title === 'Almoço'), 'CANCELLED ignorado');
  assert.ok(c.events.some((e) => e.title === 'Feriado' && e.allDay));
  console.log('✓ Calendar.refresh/state\ncalendário OK');
})().catch((e) => { console.error(e); process.exit(1); });
