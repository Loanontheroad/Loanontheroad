import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCalendar,summarise,publicUpdates,validateSearch,replaceActivity,renderSvg,calendarLayout} from './update-activity.mjs';

const fixture=Array.from({length:366},(_,i)=>{
  const date=new Date(Date.UTC(2025,9,5)+i*86400000).toISOString().slice(0,10);
  const count=i%3===0?2:0;
  return `<td data-date="${date}" data-level="${count?2:0}" id="day-${i}"></td><tool-tip for="day-${i}">${count?`${count} contributions`:'No contributions'} on a date.</tool-tip>`;
}).join('');

test('Calendar joins tooltip IDs, orders days, and counts real zeroes',()=>{
  const days=parseCalendar(fixture,'2026-10-05');
  assert.equal(days.length,366);
  const stats=summarise(days,17);
  assert.equal(stats.contributions,244);
  assert.equal(stats.activeDays,122);
  assert.equal(stats.publicCommits,17);
  assert.equal(stats.months.reduce((sum,m)=>sum+m.count,0),244);
});
test('Changed HTML, missing dates and duplicate dates fail instead of silently producing zeroes',()=>{
  assert.throws(()=>parseCalendar(fixture.replace('2 contributions on','unknown format on'),'2026-10-05'));
  assert.throws(()=>parseCalendar(fixture.replace('data-date="2026-05-06"','data-date="2026-05-07"'),'2026-10-05'));
  assert.throws(()=>parseCalendar(fixture.replace('data-date="2026-10-05"',''),'2026-10-05'));
});
test('Incomplete public searches are rejected',()=>{
  assert.throws(()=>validateSearch({total_count:0,incomplete_results:true,items:[]}));
  assert.equal(validateSearch({total_count:0,incomplete_results:false,items:[]}).total_count,0);
});
test('Private repositories and unexpected commit destinations cannot enter the README',()=>{
  const sha='a'.repeat(40);
  const item={repository:{private:false,full_name:'user/repo'},sha,html_url:`https://github.com/user/repo/commit/${sha}`,commit:{author:{date:'2026-10-01T12:00:00Z'}}};
  assert.equal(publicUpdates([item])[0].sha,sha);
  assert.throws(()=>publicUpdates([{...item,repository:{...item.repository,private:true}}]));
  assert.throws(()=>publicUpdates([{...item,html_url:'https://example.com/'}]));
});
test('Generator edits exactly its section, is repeatable, and requires unique markers',()=>{
  const original='before\n<!-- DEVELOPMENT-ACTIVITY:START -->old<!-- DEVELOPMENT-ACTIVITY:END -->\nafter';
  const block='<!-- DEVELOPMENT-ACTIVITY:START -->new<!-- DEVELOPMENT-ACTIVITY:END -->';
  const result=replaceActivity(original,block);
  assert.equal(result,'before\n'+block+'\nafter');
  assert.equal(replaceActivity(result,block),result);
  assert.throws(()=>replaceActivity('no markers',block));
  assert.throws(()=>replaceActivity(original+'<!-- DEVELOPMENT-ACTIVITY:START -->',block));
});
test('Desktop and mobile charts preserve zero activity and never contain NaN',()=>{
  const stats=summarise(parseCalendar(fixture,'2026-10-05').map(day=>({...day,count:0,level:0})),0);
  for(const options of [{},{mobile:true}]) {
    const svg=renderSvg(stats,options);
    assert.ok(!svg.includes('NaN'));
    assert.ok(svg.includes('0 GitHub contributions'));
    assert.ok(svg.includes('<desc'));
  }
});
test('Daily grids keep every date once, with correct weekday and week positions on both sizes',()=>{
  const days=parseCalendar(fixture,'2026-10-05');
  const stats=summarise(days,17);
  const layout=calendarLayout(days);
  assert.equal(layout[0].weekday,0);
  assert.equal(layout[7].week,1);
  assert.equal(layout.at(-1).weekday,1);
  assert.equal(layout.at(-1).week,52);
  for(const mobile of [false,true]) {
    const svg=renderSvg(stats,{mobile});
    const dates=[...svg.matchAll(/data-date="([^"]+)"/g)].map(m=>m[1]);
    assert.deepEqual(dates,days.map(d=>d.date));
    assert.equal(new Set(dates).size,366);
  }
});
test('Malformed calendar intensity cannot silently change the heatmap',()=>{
  assert.throws(()=>parseCalendar(fixture.replace('data-level="2"','data-level="9"'),'2026-10-05'));
  assert.throws(()=>parseCalendar(fixture.replace('data-level="2"','data-level="0"'),'2026-10-05'));
});
