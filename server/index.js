// SPOTIFY WEB API AUTHORIZATION CODE FLOW
// https://developer.spotify.com/documentation/general/guides/authorization-guide/
// https://github.com/spotify/web-api-auth-examples

require('dotenv').config();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
let REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:8888/callback';
let FRONTEND_URI = process.env.FRONTEND_URI || 'http://localhost:3000';
const PORT = process.env.PORT || 8888;

if (process.env.NODE_ENV !== 'production') {
  REDIRECT_URI = 'http://localhost:8888/callback';
  FRONTEND_URI = 'http://localhost:3000';
}
const express = require('express');
const request = require('request');
const cors = require('cors');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const path = require('path');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const http2 = require('http2-wrapper');
const history = require('connect-history-api-fallback');

const fb = require('firebase');
const db = require('firebase/firestore');
const fbadmin = require('firebase-admin');
const fetch = require('node-fetch');
const jsdom = require('jsdom');

const _ = require('lodash');
const { JSDOM } = jsdom;

// Initialize Firestore
const serviceAccount = require('./../../auth.json');

/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
const generateRandomString = function (length) {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

const stateKey = 'spotify_auth_state';

// Multi-process to utilize all CPU cores.
if (cluster.isMaster) {
  console.warn(`Node cluster master ${process.pid} is running`);

  // Fork workers.
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.error(
      `Node cluster worker ${worker.process.pid} exited: code ${code}, signal ${signal}`,
    );
  });
} else {
  const app = express();

  fbadmin.initializeApp({
    credential: fbadmin.credential.cert(serviceAccount),
    databaseURL: 'https://dbtronics-79c66.firebaseio.com',
  });

  // Priority serve any static files.
  app.use(express.static(path.resolve(__dirname, '../client/build')));

  app
    .use(express.static(path.resolve(__dirname, '../client/build')))
    .use(cors())
    .use(cookieParser())
    .use(
      history({
        verbose: true,
        rewrites: [
          { from: /\/login/, to: '/login' },
          { from: /\/callback/, to: '/callback' },
          { from: /\/refresh_token/, to: '/refresh_token' },
          { from: /\/tabs/, to: '/tabs' },
        ],
      }),
    )
    .use(express.static(path.resolve(__dirname, '../client/build')));

  /*  app.get('/', function (req, res) {
     res.render(path.resolve(__dirname, '../client/build/index.html'));
   }); */

  app.get('/login', function (req, res) {
    const state = generateRandomString(16);
    res.cookie(stateKey, state);

    // your application requests authorization
    const scope =
      'user-read-private user-read-email user-read-recently-played user-top-read user-follow-read user-follow-modify playlist-read-private playlist-read-collaborative playlist-modify-public';

    res.redirect(
      `https://accounts.spotify.com/authorize?${querystring.stringify({
        response_type: 'code',
        client_id: CLIENT_ID,
        scope: scope,
        redirect_uri: REDIRECT_URI,
        state: state,
      })}`,
    );
  });

  app.get('/callback', function (req, res) {
    // your application requests refresh and access tokens
    // after checking the state parameter

    const code = req.query.code || null;
    const state = req.query.state || null;
    const storedState = req.cookies ? req.cookies[stateKey] : null;

    if (state === null || state !== storedState) {
      res.redirect(`/#${querystring.stringify({ error: 'state_mismatch' })}`);
    } else {
      res.clearCookie(stateKey);
      const authOptions = {
        url: 'https://accounts.spotify.com/api/token',
        form: {
          code: code,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        },
        headers: {
          Authorization: `Basic ${new Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
            'base64',
          )}`,
        },
        json: true,
      };

      request.post(authOptions, function (error, response, body) {
        if (!error && response.statusCode === 200) {
          const access_token = body.access_token;
          const refresh_token = body.refresh_token;

          // we can also pass the token to the browser to make requests from there
          res.redirect(
            `${FRONTEND_URI}/#${querystring.stringify({
              access_token,
              refresh_token,
            })}`,
          );
        } else {
          res.redirect(`/#${querystring.stringify({ error: 'invalid_token' })}`);
        }
      });
    }
  });

  app.get('/refresh_token', function (req, res) {
    // requesting access token from refresh token
    const refresh_token = req.query.refresh_token;
    const authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      headers: {
        Authorization: `Basic ${new Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
          'base64',
        )}`,
      },
      form: {
        grant_type: 'refresh_token',
        refresh_token,
      },
      json: true,
    };

    request.post(authOptions, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        const access_token = body.access_token;
        res.send({ access_token });
      }
    });
  });

  /*   // All remaining requests return the React app, so it can handle routing.
    app.get('*', function (request, response) {
      response.sendFile(path.resolve(__dirname, '../client/public', 'index.html'));
    }); */

  app.listen(PORT, function () {
    console.warn(`Node cluster worker ${process.pid}: listening on port ${PORT}`);
  });

  app.get('/tabs', async (req, res) => {
    const searchq = req.query.query;
    const results = await artistSearch(searchq);
    res.json(results);
  });

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
    const datac = dom.window.document
      .getElementsByClassName('js-store')[0]
      .getAttribute('data-content');

    return JSON.parse(unescapeHTML(datac)).store.page.data;
  }

  async function artistSearch(query) {
    const pageData = await loadStoreData(
      `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURI(
        query,
      )}&limit=5`,
    );

    let results = [];
    for (let result of pageData.results) {
      if (result.marketing_type) {
        // skip the "official" tabs
        continue;
      } else if (result.type === 'Tabs' && result.rating * 1 > 4.5) {
        results.push({
          rating: result.rating,
          artistName: result.artist_name,
          songName: result.song_name,
          tabUrl: result.tab_url,
          artistUrl: result.artist_url,
          tab: result.tab_url,
          name: result.name,
          songName: result.song_name,
          artistId: result.artist_id,
          artistName: result.artist_name,
        });
      }
    }
    results.sort;
    //console.log(results)
    return results;
  }

  const searchQueryLetters = JSON.parse(
    '["a","b","d","e","f","g","h","i","j","k","l","m","o","p","q","r","s","t","u","v","w","x","y","z","0-9"]',
  );

  /*   async function getAllArtists(query) {
      let artists = []
  
      let initialSearch2 = await artistSearch(query);
  
      for (let letter of searchQueryLetters) {
        let initialSearch = await artistSearch(lol, 1);
  
        // get total page count from search metadata
        let pages = initialSearch.page_count;
  
        for (let page = 1; page < pages + 1; page++) {
          console.log(
            `Searching for artists... (letter=${letter}, page=${page}/${pages}, songname=${initialSearch[page]} ) `
          );
          let searchResults = await artistSearch(letter, page);
  
          // add artists to database
          for (let artist of searchResults.artists) {
            artists.push({
              name: artist.name,
              id: artist.id,
              url: "https://www.ultimate-guitar.com" + artist.artist_url,
            });
          }
        }
      }
  
      return artists;
    } */

  function processSearchResults(data) {
    return Object.values(data)
      .filter(d => d.type === 'Tabs')
      .map((d, key) => ({
        ...data['keys'],
        tab: d.tab_url,
        name: d.name,
        songName: d.song_name,
        artistId: d.artist_id,
        artistName: d.artist_name,
        url: 'https://www.ultimate-guitar.com' + d.artist_url,
      }));
    //console.log("290", data);
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
    /*  let songs = {
       [name]: [category]
     };
 
     let songInfo = {
       [name]: {
         artistName,
         songName,
         artistUrl,
       }
     }
 
     for (let result of pageData.results) {
       if (result.marketing_type) {
         // skip the "official" tabs
         continue;
       }
 
       let songIdentifier = result.artist_name + " - " + result.song_name;
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
       currentPage: pageData.pagination.current
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
         let bestTabInCategory = _.maxBy(
           categories[category],
           (result) => result.rating
         );
 
         songResult.categories.push({
           category: category,
           url: bestTabInCategory.tab_url,
         });
       }
 
       output.results.push(songResult);
     }
 
     return output; */
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
}
