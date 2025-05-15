const fs = require('fs');
const puppeteer = require('puppeteer');

const NPSL_URL = 'https://www.npsl.com/schedule-2025/';

async function extractGameSummaryFromActionLogTab(fixtureFrame) {
  // Wait for the timeline to appear
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
    // Metadata
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
    // Action log
    const actionLog = Array.from(document.querySelectorAll('.public-action-log .ant-timeline-item')).map(item => {
      const minute = getText('.timeline-item-head > div:first-child', item);
      const extraTime = getText('.timeline-item-head > div:nth-child(2)', item);
      const type = getText('.ant-timeline-item-content strong', item);
      // Player(s) may be in the next div(s) after <strong>
      let player = null;
      const strong = item.querySelector('.ant-timeline-item-content strong');
      if (strong) {
        const nextDiv = strong.parentElement?.nextElementSibling;
        if (nextDiv) player = nextDiv.textContent.trim();
        else {
          // Sometimes player is in the same div
          const allDivs = Array.from(item.querySelectorAll('.ant-timeline-item-content > div'));
          if (allDivs.length > 1) player = allDivs[1].textContent.trim();
        }
      }
      // Icon
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
  // Wait for the Score Breakdown tab content to appear
  await fixtureFrame.waitForSelector('.styles_container__2OwmX', { timeout: 10000 });
  return await fixtureFrame.evaluate(() => {
    // Find the breakdown rows
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
  // Wait for the statistics tables to appear
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

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(NPSL_URL, { waitUntil: 'networkidle2' });

  // Log all iframes on the main page before interaction
  let mainIframes = await page.$$eval('iframe', iframes => iframes.map(f => f.src));
  console.log('Main page iframes BEFORE click:', mainIframes);

  // Wait for the main fixture iframe to appear
  await page.waitForSelector('iframe');
  const fixtureIframeElement = await page.$('iframe');
  const fixtureFrame = await fixtureIframeElement.contentFrame();

  // Log all iframes inside the fixture iframe before interaction
  let fixtureIframesBefore = await fixtureFrame.$$eval('iframe', iframes => iframes.map(f => f.src));
  console.log('Fixture iframe iframes BEFORE click:', fixtureIframesBefore);

  // Wait for fixture divs to appear inside the iframe
  await fixtureFrame.waitForSelector('div[class*=fixture], div[class*=Fixture]', { timeout: 15000 });

  // Try to click the first button with class 'ant-btn-link' inside the iframe
  const gameButtons = await fixtureFrame.$$('button.ant-btn-link');
  if (gameButtons.length > 0) {
    await gameButtons[0].click();
    // Wait for the main content area to appear
    await fixtureFrame.waitForSelector('.sb-main-container', { timeout: 15000 });
    await page.waitForTimeout(2000); // Give extra time for content to load

    // Save the entire iframe HTML for the Team Sheet tab
    const teamSheetIframeHtml = await fixtureFrame.content();
    fs.writeFileSync('tab-team-sheet-iframe.html', teamSheetIframeHtml);
    console.log('Saved Team Sheet tab (full iframe) to tab-team-sheet-iframe.html');

    // Find all tab buttons (should be 4: Team Sheet, Statistics, Action Log, Score Breakdown)
    const tabButtons = await fixtureFrame.$$('.ant-tabs-tab-btn');
    const tabNames = ['Statistics', 'Action Log', 'Score Breakdown'];
    for (let i = 1; i < Math.min(tabButtons.length, 4); i++) {
      await tabButtons[i].click();
      await page.waitForTimeout(2000); // Wait for tab content to load
      const tabIframeHtml = await fixtureFrame.content();
      fs.writeFileSync(`tab-${tabNames[i-1].toLowerCase().replace(/ /g, '-')}-iframe.html`, tabIframeHtml);
      console.log(`Saved ${tabNames[i-1]} tab (full iframe) to tab-${tabNames[i-1].toLowerCase().replace(/ /g, '-')}-iframe.html`);
    }

    // Save the entire HTML of the fixture iframe after click
    const fixtureHtml = await fixtureFrame.content();
    fs.writeFileSync('fixture-iframe-after.html', fixtureHtml);
    console.log('Saved fixture iframe HTML after click to fixture-iframe-after.html');

    // Log all iframes on the main page after click
    let mainIframesAfter = await page.$$eval('iframe', iframes => iframes.map(f => f.src));
    console.log('Main page iframes AFTER click:', mainIframesAfter);
    // Log all iframes inside the fixture iframe after click
    let fixtureIframesAfter = await fixtureFrame.$$eval('iframe', iframes => iframes.map(f => f.src));
    console.log('Fixture iframe iframes AFTER click:', fixtureIframesAfter);

    // Click the Action Log tab (index 2)
    if (tabButtons.length > 2) {
      await tabButtons[2].click();
      await page.waitForTimeout(2000);
      const summary = await extractGameSummaryFromActionLogTab(fixtureFrame);
      fs.writeFileSync('game-summary-action-log.json', JSON.stringify(summary, null, 2));
      console.log('Extracted game summary from Action Log tab:', summary);
    } else {
      console.log('Action Log tab button not found.');
    }

    // Click the Score Breakdown tab (index 3)
    if (tabButtons.length > 3) {
      await tabButtons[3].click();
      await page.waitForTimeout(2000);
      const scoreBreakdown = await extractScoreBreakdownFromTab(fixtureFrame);
      fs.writeFileSync('game-score-breakdown.json', JSON.stringify(scoreBreakdown, null, 2));
      console.log('Extracted score breakdown from Score Breakdown tab:', scoreBreakdown);
      // Optionally, add to the summary object if you want to combine
      if (fs.existsSync('game-summary-action-log.json')) {
        const summary = JSON.parse(fs.readFileSync('game-summary-action-log.json', 'utf-8'));
        summary.score_breakdown = scoreBreakdown;
        fs.writeFileSync('game-summary-full.json', JSON.stringify(summary, null, 2));
        console.log('Wrote combined game summary to game-summary-full.json');
      }
    } else {
      console.log('Score Breakdown tab button not found.');
    }

    // Click the Statistics tab (index 1)
    if (tabButtons.length > 1) {
      await tabButtons[1].click();
      await page.waitForTimeout(2000);
      const statistics = await extractStatisticsFromTab(fixtureFrame);
      fs.writeFileSync('game-statistics.json', JSON.stringify(statistics, null, 2));
      console.log('Extracted statistics from Statistics tab:', statistics);
      // Optionally, add to the summary object if you want to combine
      if (fs.existsSync('game-summary-full.json')) {
        const summary = JSON.parse(fs.readFileSync('game-summary-full.json', 'utf-8'));
        summary.statistics = statistics;
        fs.writeFileSync('game-summary-full.json', JSON.stringify(summary, null, 2));
        console.log('Updated game-summary-full.json with statistics');
      } else if (fs.existsSync('game-summary-action-log.json')) {
        const summary = JSON.parse(fs.readFileSync('game-summary-action-log.json', 'utf-8'));
        summary.statistics = statistics;
        fs.writeFileSync('game-summary-full.json', JSON.stringify(summary, null, 2));
        console.log('Created game-summary-full.json with statistics');
      }
    } else {
      console.log('Statistics tab button not found.');
    }

    // Fallback: try to extract modal or new content as before
    const detailContent = await fixtureFrame.evaluate(() => {
      const modals = Array.from(document.querySelectorAll('div[role=dialog], .ant-modal, .modal, .MuiDialog-root'));
      if (modals.length > 0) {
        return modals.map(m => m.innerText).join('\n---\n');
      }
      const divs = Array.from(document.querySelectorAll('div')).filter(d => d.offsetParent !== null && d.innerText.length > 100);
      if (divs.length > 0) {
        divs.sort((a, b) => b.innerText.length - a.innerText.length);
        return divs[0].innerText;
      }
      return 'No modal or detail content found.';
    });
    console.log('--- GAME DETAIL CONTENT ---\n', detailContent.slice(0, 2000));
  } else {
    console.log('No clickable game button (ant-btn-link) found in the fixture iframe.');
  }

  // Do not close the browser so the user can inspect visually
  // await browser.close();
})(); 