const fs = require('fs');
const puppeteer = require('puppeteer');
const axios = require('axios');

const NPSL_URL = 'https://www.npsl.com/schedule-2025/';
const OPENAI_API_KEY = 'YOUR_KEY_HERE'; // <-- Insert your API key here

async function extractGameSummaryFromActionLogTab(fixtureFrame) {
  await fixtureFrame.waitForSelector('.public-action-log', { timeout: 10000 });
  return await fixtureFrame.evaluate(() => {
    function getText(selector, parent = document) {
      const el = parent.querySelector(selector);
      return el ? el.textContent.trim() : null;
    }
    function getImgSrc(selector, parent = document) {
      const el = parent.querySelector(selector);
      return el ? el.src : null;
    }
    const date = getText('.sh-match-time-container .mr-4');
    const time = getText('.sh-match-time-container .anticon-clock-circle')
      ? getText('.sh-match-time-container .d-flex.align-items-center')?.replace(/^[^\d]*(\d{1,2}:\d{2}).*$/, '$1')
      : null;
    const venue = getText('.sh-match-time-container > div:nth-child(3)');
    const homeTeam = {
      name: getText('.sh-team-row .ant-col:first-child .text-right'),
      logo: getImgSrc('.sh-team-row .ant-col:first-child img')
    };
    const awayTeam = {
      name: getText('.sh-team-row .ant-col:last-child div:last-child'),
      logo: getImgSrc('.sh-team-row .ant-col:last-child img')
    };
    const score = getText('.sh-team-row .ant-col.ant-col-xs-6 .sc-hVkBjg');
    const matchStatus = getText('.sh-match-state-container > div:first-child')?.replace('Match Status: ', '');
    const competition = getText('.sh-match-state-container > div:nth-child(2)')?.replace('Competition: ', '');
    const matchId = getText('.sh-match-id-container')?.replace('Match ID: ', '');
    const actionLog = Array.from(document.querySelectorAll('.public-action-log .ant-timeline-item')).map(item => {
      const minute = getText('.timeline-item-head > div:first-child', item);
      const extraTime = getText('.timeline-item-head > div:nth-child(2)', item);
      const type = getText('.ant-timeline-item-content strong', item);
      let player = null;
      const strong = item.querySelector('.ant-timeline-item-content strong');
      if (strong) {
        const nextDiv = strong.parentElement?.nextElementSibling;
        if (nextDiv) player = nextDiv.textContent.trim();
        else {
          const allDivs = Array.from(item.querySelectorAll('.ant-timeline-item-content > div'));
          if (allDivs.length > 1) player = allDivs[1].textContent.trim();
        }
      }
      const iconImg = item.querySelector('.ant-timeline-item-content img');
      const icon = iconImg ? (iconImg.src.split('/').pop() || iconImg.alt) : null;
      return {
        minute,
        extra_time: extraTime,
        type,
        player,
        icon
      };
    });
    return {
      date,
      time,
      venue,
      home_team: homeTeam,
      away_team: awayTeam,
      score,
      match_status: matchStatus,
      competition,
      match_id: matchId,
      action_log: actionLog
    };
  });
}

async function extractScoreBreakdownFromTab(fixtureFrame) {
  await fixtureFrame.waitForSelector('.styles_container__2OwmX', { timeout: 10000 });
  return await fixtureFrame.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.styles_container__2OwmX .styles_playerRow__LqwaL'));
    const breakdown = rows.map(row => {
      const cells = row.querySelectorAll('.styles_playerData__oNSpO');
      if (cells.length === 3) {
        return {
          period: cells[0].textContent.trim(),
          home: cells[1].textContent.trim(),
          away: cells[2].textContent.trim()
        };
      }
      return null;
    }).filter(Boolean);
    return breakdown;
  });
}

async function extractStatisticsFromTab(fixtureFrame) {
  await fixtureFrame.waitForSelector('.team-statistics-table', { timeout: 10000 });
  return await fixtureFrame.evaluate(() => {
    function extractTable(tableWrapper) {
      const table = tableWrapper.querySelector('table');
      if (!table) return [];
      const rows = Array.from(table.querySelectorAll('tbody tr')).filter(row => row.querySelectorAll('td').length > 0);
      return rows.map(row => {
        const cells = row.querySelectorAll('td');
        return {
          number: cells[0]?.textContent.trim() || null,
          name: cells[1]?.textContent.trim() || null,
          goals: cells[2]?.textContent.trim() || null,
          assists: cells[3]?.textContent.trim() || null,
          yellow_cards: cells[4]?.textContent.trim() || null,
          red_cards: cells[5]?.textContent.trim() || null,
          minutes_played: cells[6]?.textContent.trim() || null
        };
      });
    }
    const teamTables = document.querySelectorAll('.team-statistics-table');
    const teams = document.querySelectorAll('.sc-iMfspA');
    return {
      home_team: {
        name: teams[0]?.textContent.trim() || null,
        stats: extractTable(teamTables[0])
      },
      away_team: {
        name: teams[1]?.textContent.trim() || null,
        stats: extractTable(teamTables[1])
      }
    };
  });
}

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(NPSL_URL, { waitUntil: 'networkidle2' });

  // Wait for the main fixture iframe to appear
  await page.waitForSelector('iframe');
  const fixtureIframeElement = await page.$('iframe');
  const fixtureFrame = await fixtureIframeElement.contentFrame();

  // Wait for fixture divs to appear inside the iframe
  await fixtureFrame.waitForSelector('div[class*=fixture], div[class*=Fixture]', { timeout: 15000 });

  // Click the first game button
  const gameButtons = await fixtureFrame.$$('button.ant-btn-link');
  if (gameButtons.length === 0) {
    console.error('No clickable game button (ant-btn-link) found in the fixture iframe.');
    await browser.close();
    return;
  }
  await gameButtons[0].click();
  await fixtureFrame.waitForSelector('.sb-main-container', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Find all tab buttons
  const tabButtons = await fixtureFrame.$$('.ant-tabs-tab-btn');

  // Extract Action Log tab (index 2)
  if (tabButtons.length > 2) {
    await tabButtons[2].click();
    await page.waitForTimeout(2000);
  }
  const summary = await extractGameSummaryFromActionLogTab(fixtureFrame);

  // Extract Score Breakdown tab (index 3)
  let scoreBreakdown = null;
  if (tabButtons.length > 3) {
    await tabButtons[3].click();
    await page.waitForTimeout(2000);
    scoreBreakdown = await extractScoreBreakdownFromTab(fixtureFrame);
    summary.score_breakdown = scoreBreakdown;
  }

  // Extract Statistics tab (index 1)
  let statistics = null;
  if (tabButtons.length > 1) {
    await tabButtons[1].click();
    await page.waitForTimeout(2000);
    statistics = await extractStatisticsFromTab(fixtureFrame);
    summary.statistics = statistics;
  }

  fs.writeFileSync('game-summary-full.json', JSON.stringify(summary, null, 2));
  console.log('Extracted full game summary to game-summary-full.json');

  await browser.close();

  // Now call OpenAI API for a summary
  const prompt = `You are a sports journalist. You are given a JSON object representing a soccer game, with the following structure:\n\n- date, time, venue, home_team, away_team, score, match_status, competition, match_id\n- action_log: array of events (minute, extra_time, type, player, icon)\n- score_breakdown: array of periods with home/away scores\n- statistics: player stats for both teams (number, name, goals, assists, yellow_cards, red_cards, minutes_played)\n\nPlease write a concise, engaging summary of the match for a general audience.\n\nFormat:\n- 1-2 sentences on the overall result and key moments\n- 1-2 sentences highlighting standout players or performances\n- 1 sentence on any notable statistics or trends\n\nHere is the game object:\n\n${JSON.stringify(summary, null, 2)}\n\nSummary:`;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 300,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const summaryText = response.data.choices[0].message.content;
    fs.writeFileSync('game-summary-llm.txt', summaryText);
    console.log('Game summary from LLM:', summaryText);
  } catch (err) {
    console.error('Error calling OpenAI API:', err.response?.data || err.message);
  }
}

main(); 