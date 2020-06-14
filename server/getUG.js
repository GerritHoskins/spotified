const fetch = require('node-fetch');
const jsdom = require('jsdom');

const _ = require('lodash');
const { JSDOM } = jsdom;

function unescapeHTML(text) {
  // replace HTML escape caracters with their original counterparts
  return text
    .replace('&amp', '&')
    .replace('&lt', '<')
    .replace('&gt', '>')
    .replace('&quot', '"')
    .replace('&#x27', "'");
}

async function loadStoreData(url) {
  let response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36',
    },
  });
  let dom = new JSDOM(await response.text());

  let dataContent;
  if (
    dom.window.document &&
    dom.window.document.getElementsByClassName('js-store')[0] &&
    dom.window.document.getElementsByClassName('js-store')[0].getAttribute('data-content').length >
      0
  ) {
    dataContent = dom.window.document
      .getElementsByClassName('js-store')[0]
      .getAttribute('data-content');
  } // tab data happens to be stored in a div labeled "js-store". this is the basis for the UGTab constructor

  // go directly to the useful data, most of it is google analytics/ad related
  return JSON.parse(unescapeHTML(dataContent)).store.page.data;
}

async function artistSearch(letter, page) {
  return await loadStoreData(`https://www.ultimate-guitar.com/bands/${letter}${page}.htm`);
}

const searchQueryLetters = JSON.parse(
  '["a","b","d","e","f","g","h","i","j","k","l","m","o","p","q","r","s","t","u","v","w","x","y","z","0-9"]',
);

async function getAllArtists() {
  let artists = {};

  for (let letter of searchQueryLetters) {
    let initialSearch = await artistSearch(letter, 1);

    // get total page count from search metadata
    let pages = initialSearch.page_count;

    for (let page = 1; page < pages + 1; page++) {
      console.log(`Searching for artists... (letter=${letter}, page=${page}/${pages})`);
      let searchResults = await artistSearch(letter, page);

      // add artists to database
      for (let artist of searchResults.artists) {
        artists.push({
          name: artist.name,
          id: artist.id,
          url: 'https://www.ultimate-guitar.com' + artist.artist_url,
        });
      }
    }
  }

  return artists;
}

function processSearchResults(pageData) {
  // this function is a mess

  /*
        example data for "songs" with query "never gonna":
        
        songs = {
            "rick astley - never gonna give you up": {
                "chords": [
                    <GeneralSearch.Result>,
                    <GeneralSearch.Result>,
                    ...
                ],
                "tabs": [
                    <GeneralSearch.Result>,
                    <GeneralSearch.Result>,
                    ...
                ]
            },
            "jonathan jeremiah - never gonna": {
                "chords": [
                    ...
                ]
            }
        }
    */
  let songs = {
    [name]: [category],
  };

  let songInfo = {
    [name]: {
      artistName,
      songName,
      artistUrl,
    },
  };

  for (let result of pageData.results) {
    if (result.marketing_type) {
      // skip the "official" tabs
      continue;
    }

    let songIdentifier = result.artist_name + ' - ' + result.song_name;
    if (!songs[songIdentifier]) {
      songs[songIdentifier] = {};
    }
    if (!songs[songIdentifier][result.type]) {
      songs[songIdentifier][result.type] = [];
    }

    songs[songIdentifier][result.type].push(result);

    songInfo[songIdentifier] = {
      artistName: result.artist_name,
      songName: result.song_name,
      artistUrl: result.artist_url,
    };
  }

  let output = {
    results: [],
    numberTotalResults: pageData.results_count,
    totalPages: pageData.pagination.total,
    currentPage: pageData.pagination.current,
  };

  // get the highest rated song of each category and add it to the final output

  for (let [songIdentifier, categories] of Object.entries(songs)) {
    let song = songInfo[songIdentifier];

    let songResult = {
      songName: song.songName,
      artistName: song.artistName,
      artistUrl: song.artistUrl,
      categories: [],
    };

    for (let category of Object.keys(categories)) {
      let bestTabInCategory = _.maxBy(categories[category], result => result.rating);

      songResult.categories.push({
        category: category,
        url: bestTabInCategory.tab_url,
      });
    }

    output.results.push(songResult);
  }

  return output;
}

async function search(query, page) {
  let searchResults = processSearchResults(
    await loadStoreData(
      `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURI(
        query,
      )}&page=${page}`,
    ),
  );

  // basically sometimes the full results of the last song on the list get cut off by the page boundary
  // which means that the client will often load two copies of the same song (one for each
  // portion on the page)
  // when this happens, ultimateguitar will put the whole song list on the next page
  // including the first part from the previous page

  // therefore we should remove the last song on the list (as it might be incomplete)
  // but only if there's a next page

  if (searchResults.currentPage < searchResults.totalPages) {
    // we also don't want to remove the only song on the list if there's only one
    if (searchResults.results.length > 1) {
      searchResults.results.pop(); // remove the last element from the array
    }
  }

  return searchResults;
}

async function searchAutocomplete(query) {
  /* Returns Ultimate Guitar's search suggestion for the given query */

  // ultimate guitar does this really weirdly idk what the devs were on when they made this system

  if (!query) {
    return [];
  }

  query = query.trim();
  let queryFile = query.replace(' ', '_').substring(0, 5) + '.js';

  let response = await fetch(
    `https://tabs.ultimate-guitar.com/static/article/suggestions/${query[0]}/${queryFile}`,
  );

  if (response.ok) {
    // get pranked it's not really a js file it's just some json data ????
    let allSuggestions = (await response.json()).suggestions;
    return allSuggestions.filter(suggestion => suggestion.startsWith(query));
  } else {
    return [];
  }
}
