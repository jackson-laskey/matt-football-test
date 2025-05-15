const axios = require('axios');
const cheerio = require('cheerio');

const NPSL_URL = 'https://www.npsl.com/schedule-2025/';

async function fetchSchedule() {
  try {
    const { data } = await axios.get(NPSL_URL);
    const $ = cheerio.load(data);
    // TODO: Update selector logic once we inspect the page structure
    console.log('Fetched NPSL 2025 schedule page.');
    // Example: print the page title
    console.log($('title').text());
    // Add scraping logic for games and box scores here
  } catch (error) {
    console.error('Error fetching schedule:', error.message);
  }
}

fetchSchedule(); 