import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { catchErrors } from '../utils';
import { getTabs } from '../spotify';
import Loader from './Loader';

import styled from 'styled-components/macro';
import { theme, mixins, media, Main } from '../styles';
const { colors, fontSizes, spacing } = theme;

const TabsCpntainer = styled(Main)`
  ${mixins.flexCenter};
  flex-direction: column;
  height: 100%;
  text-align: center;
`;

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
      <TabsCpntainer>
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
      </TabsCpntainer>
    );
  }
}

export default Tab;
