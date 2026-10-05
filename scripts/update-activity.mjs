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
    days.push({date,count});
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
    publicCommits,
    months:[...months].map(([month,count])=>({month,count}))
  };
}

export function validateSearch(result) {
  if (result.incomplete_results !== false || !Number.isSafeInteger(result.total_count) || result.total_count < 0 || !Array.isArray(result.items)) {
    throw new Error('GitHub returned an incomplete search; previous activity is preserved.');
  }
  return result;
}

export function publicUpdates(items) {
  return items.slice(0,3).map(item=> {
    if (item.repository?.private !== false || !/^[\w.-]+\/[\w.-]+$/.test(item.repository.full_name) || !/^[0-9a-f]{40}$/.test(item.sha)) throw new Error('Invalid public commit.');
    const expected = `https://github.com/${item.repository.full_name}/commit/${item.sha}`;
    if(item.html_url !== expected || !Number.isFinite(Date.parse(item.commit?.author?.date))) throw new Error('Invalid commit URL or date.');
    return {repository:item.repository.full_name,sha:item.sha,url:expected,date:item.commit.author.date.slice(0,10)};
  });
}

export function renderSvg(stats,{mobile=false}={}) {
  const width=mobile?420:860, height=mobile?362:338;
  const c={bg:'#f8f8f6',ink:'#0e1013',muted:'#59636e',grid:'#dce0e5',blue:'#2743ff'};
  const left=mobile?42:48,right=width-22,top=mobile?132:124,bottom=height-68;
  const peak=Math.max(1,...stats.months.map(m=>m.count));
  const ceiling=Math.ceil(peak/(peak>100?100:10))*(peak>100?100:10);
  const points=stats.months.map((month,i)=>({x:left+(right-left)*i/(stats.months.length-1),y:bottom-(bottom-top)*month.count/ceiling,...month}));
  const line=points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const text=(x,y,value,size=13,weight=400,fill=c.muted,extra='')=>`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${escapeXml(value)}</text>`;
  const statsX=mobile?[20,158,296]:[24,320,604];
  const metrics=[[stats.contributions,'Contributions'],[stats.activeDays,'Active days'],[stats.publicCommits,'Public commits']];
  const dates=new Intl.DateTimeFormat('en-US',{month:'short',year:'numeric',timeZone:'UTC'});
  let body=`<rect width="${width}" height="${height}" fill="${c.bg}"/>`;
  metrics.forEach(([value,label],i)=>{body+=text(statsX[i],50,fmt(value),mobile?34:40,650,c.ink)+text(statsX[i],74,label,mobile?16:14);});
  body+=text(24,mobile?106:102,'Monthly contributions',mobile?15:13,500,c.ink);
  for(const value of [0,ceiling/2,ceiling]) {
    const y=bottom-(bottom-top)*value/ceiling;
    body+=`<path d="M${left} ${y}H${right}" stroke="${c.grid}" stroke-width="1"/>`+text(left-8,y+4,fmt(value),mobile?13:10,400,c.muted,'text-anchor="end"');
  }
  body+=`<path d="${line} L${right},${bottom} L${left},${bottom} Z" fill="${c.blue}" fill-opacity=".06"/><path d="${line}" fill="none" stroke="${c.blue}" stroke-width="2.5" stroke-linejoin="round"/>`;
  points.forEach((p,i)=>{
    body+=`<circle cx="${p.x}" cy="${p.y}" r="3" fill="${c.bg}" stroke="${c.blue}" stroke-width="1.5"><title>${escapeXml(dates.format(new Date(p.month+'-01T00:00:00Z')))}: ${p.count} contributions</title></circle>`;
    if (!mobile || i===0 || i===points.length-1 || i%3===0) {
      const partial=(i===0&&stats.from.slice(-2)!=='01')||(i===points.length-1&&new Date(Date.parse(stats.to)+DAY).toISOString().slice(0,7)===p.month);
      const label=new Date(p.month+'-01T00:00:00Z').toLocaleDateString('en-US',{month:'short',timeZone:'UTC'})+(partial?'*':'');
      const anchor=i===0?'start':i===points.length-1?'end':'middle';
      body+=text(p.x,bottom+23,label,mobile?14:11,400,c.muted,`text-anchor="${anchor}"`);
      if(i===0||i===points.length-1) body+=text(p.x,bottom+37,p.month.slice(0,4),mobile?12:10,400,c.muted,`text-anchor="${anchor}"`);
    }
  });
  body+=text(24,height-14,`Updated ${stats.to} · * Partial months`,mobile?13:11);
  const description=`${fmt(stats.contributions)} GitHub contributions across ${stats.activeDays} active days, and ${stats.publicCommits} public commits. ${stats.from} to ${stats.to}.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description"><title id="title">Development activity</title><desc id="description">${escapeXml(description)}</desc><g font-family="Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">${body}</g></svg>\n`;
}

export function activityMarkdown(stats,updates) {
  const alt=escapeXml(`${fmt(stats.contributions)} contributions, ${stats.activeDays} active days and ${stats.publicCommits} public commits. ${stats.from} to ${stats.to}.`);
  const updateLines=updates.map(item=> {
    const date=new Date(item.date+'T00:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});
    return `- **[${item.repository}](${item.url})** · ${date} · [\`${item.sha.slice(0,7)}\`](${item.url})`;
  });
  return `${START}\n\n<picture>\n  <source media="(max-width: 600px)" srcset="assets/activity-mobile.svg">\n  <img src="assets/activity.svg" width="100%" alt="${alt}">\n</picture>\n\n### Latest public project commits\n\n${updateLines.length?updateLines.join('\n'):'No public project commits in this period.'}\n\n<details>\n<summary>View activity data</summary>\n\n${stats.from} to ${stats.to}. The calendar reflects contributions visible on my GitHub profile, including anonymised private activity when enabled. Commit counts and links cover public repositories. The first and last months may be partial.\n\n| Month | Contributions |\n| :--- | ---: |\n${stats.months.map(({month,count})=>`| ${month} | ${fmt(count)} |`).join('\n')}\n\n</details>\n\n${END}`;
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
  const [all,recent]=await Promise.all([
    get(searchUrl(period)),get(searchUrl(`${period} -repo:${username}/${username}`))
  ]);
  const stats=summarise(days,validateSearch(all).total_count);
  const updates=publicUpdates(validateSearch(recent).items);
  const original=await readFile(path.join(root,'README.md'),'utf8');
  const readme=replaceActivity(original,activityMarkdown(stats,updates));
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
  console.log(JSON.stringify({...stats,updates,source:'Public GitHub endpoints; no API token used'},null,2));
  return {stats,updates};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  updateActivity().catch(error=>{console.error(error.message);process.exitCode=1;});
}
