import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { catchErrors } from '../utils';
import { getTabs } from '../spotify';

import Loader from './Loader';

class Tab extends Component {
  state = {
    artists: null,
  };

  componentDidMount() {
    catchErrors(this.getData());
  }
  async getData() {
    const query = 'U2 One';

    //const artists = await  getTabs("a1");
    const artists = await getTabs(query);
    //console.log(artists);
    if (artists) {
      this.setState({ artists: artists.data });
    }
  }

  render() {
    const { artists } = this.state;

    return (
      <React.Fragment>
        {artists ? (
          <>
            <div>{artists[0].songName}</div>
            <div>{artists[0].artistName}</div>
            {artists.map((tab, index) => {
              return (
                <div key={tab.tab}>
                  <div>{tab.tab}</div>
                </div>
              );
            })}
          </>
        ) : (
          <Loader />
        )}
      </React.Fragment>
    );
  }
}

export default Tab;
