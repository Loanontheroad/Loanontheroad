import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- DEVELOPMENT-ACTIVITY:START -->';
const END = '<!-- DEVELOPMENT-ACTIVITY:END -->';
const DAY = 86_400_000;
const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const attribute = (attrs, name) => attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
const number = value => Number(value.replace(/,/g,''));
const fmt = value => value.toLocaleString('en-US');

export function parseCalendar(html, today) {
  const tooltips = new Map();
  for (const match of html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/g)) {
    const id = attribute(match[1], 'for');
    const text = match[2].replace(/<[^>]*>/g, '').trim();
    if (id) tooltips.set(id, text);
  }
  const lower = new Date(`${today}T00:00:00Z`);
  lower.setUTCFullYear(lower.getUTCFullYear()-1);
  const from = lower.toISOString().slice(0,10);
  const days = [];
  for (const match of html.matchAll(/<td\b([^>]*)>[\s\S]*?<\/td>/g)) {
    const date = attribute(match[1], 'data-date');
    if (!date || date < from || date > today) continue;
    const text = tooltips.get(attribute(match[1], 'id'));
    let count;
    if (/^No contributions? on /.test(text ?? '')) count = 0;
    else {
      const result = text?.match(/^([\d,]+) contributions? on /);
      if (!result) throw new Error(`Unrecognised contribution data for ${date}; previous activity is preserved.`);
      count = number(result[1]);
    }
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid contribution count.');
    const rawLevel=attribute(match[1], 'data-level');
    const level=rawLevel===undefined?Math.min(4,Math.ceil(Math.log2(count+1))):Number(rawLevel);
    if (!Number.isInteger(level)||level<0||level>4||(count===0)!==(level===0)) throw new Error('Invalid contribution intensity.');
    days.push({date,count,level});
  }
  days.sort((a,b)=>a.date.localeCompare(b.date));
  const expectedDays=(Date.parse(today)-Date.parse(from))/DAY+1;
  if (days.length !== expectedDays || days[0]?.date !== from || days.at(-1)?.date !== today) throw new Error('GitHub did not return a complete, current contribution calendar.');
  for (let i=1;i<days.length;i++) {
    if (Date.parse(days[i].date)-Date.parse(days[i-1].date)!==DAY) throw new Error('Contribution dates are missing or duplicated.');
  }
  return days;
}

export function summarise(days, publicCommits) {
  const months = new Map();
  for(const {date,count} of days) months.set(date.slice(0,7),(months.get(date.slice(0,7))??0)+count);
  return {
    from:days[0].date,to:days.at(-1).date,
    contributions:days.reduce((total,day)=>total+day.count,0),
    activeDays:days.filter(day=>day.count>0).length,
    publicCommits,days,
    months:[...months].map(([month,count])=>({month,count}))
  };
}

export function validateSearch(result) {
  if (result.incomplete_results !== false || !Number.isSafeInteger(result.total_count) || result.total_count < 0 || !Array.isArray(result.items)) {
    throw new Error('GitHub returned an incomplete search; previous activity is preserved.');
  }
  return result;
}

export function calendarLayout(days) {
  const first=new Date(days[0].date+'T00:00:00Z');
  const sunday=first.getTime()-first.getUTCDay()*DAY;
  return days.map(day=>({...day,week:Math.floor((Date.parse(day.date)-sunday)/(7*DAY)),weekday:new Date(day.date+'T00:00:00Z').getUTCDay()}));
}

export function renderSvg(stats,{mobile=false}={}) {
  const width=mobile?420:860, height=mobile?438:306;
  const c={bg:'#f8f8f6',ink:'#0e1013',muted:'#59636e',empty:'#cfd5dc'};
  const blues=['none','#a8b7ff','#7a92ff','#4c69ff','#2743ff'];
  const cells=calendarLayout(stats.days), weeks=cells.at(-1).week+1;
  const split=mobile?Math.ceil(weeks/2):weeks;
  const left=mobile?56:56,right=width-24;
  const stepX=(right-left)/(split-1),stepY=mobile?12.5:15;
  const radius=mobile?4.2:4.8;
  const text=(x,y,value,size=13,weight=400,fill=c.muted,extra='')=>`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${escapeXml(value)}</text>`;
  const statsX=mobile?[20,158,296]:[24,320,604];
  const metrics=[[stats.contributions,'Contributions'],[stats.activeDays,'Active days'],[stats.publicCommits,'Public commits']];
  let body=`<rect width="${width}" height="${height}" fill="${c.bg}"/>`;
  metrics.forEach(([value,label],i)=>{body+=text(statsX[i],50,fmt(value),mobile?34:40,650,c.ink)+text(statsX[i],74,label,mobile?16:14);});
  body+=text(24,105,'Daily contributions',mobile?15:13,500,c.ink);
  for(let panel=0;panel<(mobile?2:1);panel++) {
    const panelCells=cells.filter(day=>Math.floor(day.week/split)===panel);
    const top=mobile?150+panel*143:145;
    for(const [weekday,label] of [[1,'Mon'],[3,'Wed'],[5,'Fri']]) body+=text(24,top+weekday*stepY+4,label,mobile?13:11);
    let previousMonth, previousLabelRight=-Infinity;
    for(const cell of panelCells) {
      const x=left+(cell.week%split)*stepX,y=top+cell.weekday*stepY;
      if(cell.date.slice(0,7)!==previousMonth) {
        const month=cell.date.slice(0,7);
        let label=new Date(month+'-01T00:00:00Z').toLocaleDateString('en-US',{month:'short',timeZone:'UTC'});
        if(!mobile&&month.endsWith('-01'))label+=' '+month.slice(2,4);
        const anchor=x>right-35?'end':'start';
        const labelWidth=label.length*(mobile?13:12)*0.58;
        const labelLeft=anchor==='end'?x-labelWidth:x;
        const nextMonth=panelCells.find(day=>day.date.slice(0,7)>month);
        const nextX=nextMonth?left+(nextMonth.week%split)*stepX:Infinity;
        const crampedLeadingMonth=!previousMonth&&nextX-x<labelWidth+6;
        if(!crampedLeadingMonth&&labelLeft>=previousLabelRight+6) {
          body+=text(x,top-19,label,mobile?13:12,400,c.muted,`text-anchor="${anchor}"`);
          previousLabelRight=labelLeft+labelWidth;
        }
        previousMonth=month;
      }
      body+=`<circle data-date="${cell.date}" data-count="${cell.count}" data-week="${cell.week}" data-weekday="${cell.weekday}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius}" fill="${blues[cell.level]}"${cell.level===0?` stroke="${c.empty}" stroke-width="1"`:''}><title>${cell.date}: ${cell.count} ${cell.count===1?'contribution':'contributions'}</title></circle>`;
    }
  }
  const legendY=mobile?395:267,legendX=mobile?220:660;
  body+=text(legendX,legendY+4,'Less',mobile?12:11);
  for(let level=0;level<=4;level++)body+=`<circle cx="${legendX+39+level*17}" cy="${legendY}" r="4" fill="${blues[level]}"${level===0?` stroke="${c.empty}" stroke-width="1"`:''}/>`;
  body+=text(legendX+123,legendY+4,'More',mobile?12:11);
  body+=text(24,legendY+4,'One dot, one day.',mobile?13:12);
  body+=text(24,height-15,`Updated ${stats.to}`,mobile?13:11);
  const description=`${fmt(stats.contributions)} GitHub contributions across ${stats.activeDays} active days, and ${stats.publicCommits} public commits. ${stats.from} to ${stats.to}.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description"><title id="title">Development activity</title><desc id="description">${escapeXml(description)}</desc><g font-family="Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">${body}</g></svg>\n`;
}

export function activityMarkdown(stats) {
  const alt=escapeXml(`${fmt(stats.contributions)} contributions, ${stats.activeDays} active days and ${stats.publicCommits} public commits. ${stats.from} to ${stats.to}.`);
  return `${START}\n\n<picture>\n  <source media="(max-width: 600px)" srcset="assets/activity-mobile.svg">\n  <img src="assets/activity.svg" width="100%" alt="${alt}">\n</picture>\n\n<details>\n<summary>View activity data</summary>\n\n${stats.from} to ${stats.to}. The calendar reflects contributions visible on my GitHub profile, including anonymised private activity when enabled. Commit counts cover public repositories. The first and last months may be partial.\n\n| Month | Contributions |\n| :--- | ---: |\n${stats.months.map(({month,count})=>`| ${month} | ${fmt(count)} |`).join('\n')}\n\n</details>\n\n${END}`;
}

export function replaceActivity(readme,block) {
  const start=readme.indexOf(START),end=readme.indexOf(END);
  if(start<0||end<start||readme.indexOf(START,start+1)>=0||readme.indexOf(END,end+1)>=0) throw new Error('Exactly one activity marker pair is required.');
  return readme.slice(0,start)+block+readme.slice(end+END.length);
}

async function get(url,json=true) {
  const response=await fetch(url,{headers:{'User-Agent':'CodedByLoan-profile-activity','Accept':json?'application/vnd.github+json':'text/html'},signal:AbortSignal.timeout(25_000)});
  if(!response.ok) throw new Error(`Public GitHub request failed (${response.status}); previous activity is preserved.`);
  return json?response.json():response.text();
}

export async function updateActivity(root=ROOT, username=process.env.PROFILE_USER??'Loanontheroad') {
  if(!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) throw new Error('Invalid GitHub username.');
  const today=new Date().toISOString().slice(0,10);
  const calendar=await get(`https://github.com/users/${username}/contributions`,false);
  const days=parseCalendar(calendar,today);
  const period=`author:${username} author-date:${days[0].date}..${today}`;
  const searchUrl=query=>`https://api.github.com/search/commits?q=${encodeURIComponent(query)}&sort=author-date&order=desc&per_page=3`;
  const all=await get(searchUrl(period));
  const stats=summarise(days,validateSearch(all).total_count);
  const original=(await readFile(path.join(root,'README.md'),'utf8')).replace(/\r\n/g,'\n');
  const readme=replaceActivity(original,activityMarkdown(stats));
  const assets=path.join(root,'assets');
  await mkdir(assets,{recursive:true});
  // Validate all input before replacing any files. Fetch failures never produce zeroed charts.
  const files=[
    ['activity.svg',renderSvg(stats)],['activity-mobile.svg',renderSvg(stats,{mobile:true})]
  ];
  for(const [name,svg] of files) await writeFile(path.join(assets,name+'.tmp'),svg);
  await writeFile(path.join(root,'README.md.tmp'),readme);
  for(const [name] of files) await rename(path.join(assets,name+'.tmp'),path.join(assets,name));
  await rename(path.join(root,'README.md.tmp'),path.join(root,'README.md'));
  const {days:dailyData,...summary}=stats;
  console.log(JSON.stringify({...summary,source:'Public GitHub endpoints; no API token used'},null,2));
  return {stats};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  updateActivity().catch(error=>{console.error(error.message);process.exitCode=1;});
}
