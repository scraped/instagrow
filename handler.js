require('dotenv').config();
const Promise = require('bluebird');
const constants = require("./src/constants");
const dynamoDBHandler = require("./src/services/dynamodb").handler;
const getLatestMediaOfAccounts = require("./src/getLatestMediaOfAccounts");
const addPendingLikeMediaToQueue = require("./src/addPendingLikeMediaToQueue");
const getAccountFollowers = require("./src/getAccountFollowers");
const getAccountsFollowing = require("./src/getAccountsFollowing");
const getLatestActivityOfAccounts = require("./src/getLatestActivityOfAccounts");
const likedMedia = require("./src/updateLikedMedia");

const getSetupVars = async (event) => {
  const username = event["account"] || process.env.ACCOUNT;
  if (!username) {
    throw new Error("Incorrect configuration - missing account");
  }

  return {
    username,
  };
}

module.exports.setUpNewApplication = async (event, context, callback) => {
  let response = {};
  try {
    dynamoDBHandler.createInstance();
    dynamoDBHandler.getInstance().createGeneralDB();

    response = {
      statusCode: 200,
      body: JSON.stringify({
        message: `Successful run`,
      })
    };
  } catch(err) {
    console.error(`Error ${err}`);
    response = {
      statusCode: 400,
      body: JSON.stringify({
        message: err,
      }),
    };
  } finally {
    callback(null, response);
  }
};

module.exports.setUpNewUserConfig = async (event, context, callback) => {
  let response = {};
  try {
    const username = process.env.ACCOUNT;
    const password = process.env.PASSWORD;
    const followingInteractionDeltaInDays = process.env.FOLLOWING_INTERACTION_DELTA_IN_DAYS || constants.FOLLOWING_INTERACTION_DELTA_IN_DAYS;
    const followerInteractionDeltaInDays = process.env.FOLLOWER_INTERACTION_DELTA_IN_DAYS || constants.FOLLOWER_INTERACTION_DELTA_IN_DAYS;

    if (!username) {
      throw new Error("Incorrect configuration - missing username");
    }

    if (!password) {
      throw new Error("Incorrect configuration - missing password");
    }

    dynamoDBHandler.createInstance();
    await dynamoDBHandler.getInstance().createAccountDB(username);
    await dynamoDBHandler.getInstance().putUserAuthentication(username, password);
    await dynamoDBHandler.getInstance().putUserEnabled(username, false);
    await dynamoDBHandler.getInstance().putUserFollowingInteractionDeltaInDays(username, followingInteractionDeltaInDays);
    await dynamoDBHandler.getInstance().putUserFollowerInteractionDeltaInDays(username, followerInteractionDeltaInDays);

    response = {
      statusCode: 200,
      body: JSON.stringify({
        message: `Successful run`,
      })
    };
  } catch(err) {
    console.error(`Error ${err}`);
    response = {
      statusCode: 400,
      body: JSON.stringify({
        message: err,
      }),
    };
  } finally {
    callback(null, response);
  }
};

module.exports.setUpScalingPolicy = async (event, context, callback) => {
  let response = {};
  try {
    const username = process.env.ACCOUNT;

    if (!username) {
      throw new Error("Incorrect configuration - missing username");
    }

    dynamoDBHandler.createInstance();
    await dynamoDBHandler.getInstance().createAccountScalingPolicy(username);

    response = {
      statusCode: 200,
      body: JSON.stringify({
        message: `Successful run`,
      })
    };
  } catch(err) {
    console.error(`Error ${err}`);
    response = {
      statusCode: 400,
      body: JSON.stringify({
        message: err,
      }),
    };
  } finally {
    callback(null, response);
  }
};

module.exports.getFollowers = async (event, context, callback) => {
  let response = {};
  try {
    const getFollowersAsync = async ({username, password}) => {
      const numAccountFollowers = await getAccountFollowers({username, password});
      return numAccountFollowers;
    }

    dynamoDBHandler.createInstance();
    const username = await dynamoDBHandler.getInstance().getNextUserForFunction('getFollowers');
    if (!username) throw new Error("No username defined for function 'getFollowers'");

    const password = await dynamoDBHandler.getInstance().getPasswordForUser(username);
    if (!password) throw new Error("No password defined for function 'getFollowers'");

    const numAccountFollowers = await getFollowersAsync({username, password});
    await dynamoDBHandler.getInstance().putTimestampForFunction(username, 'getFollowers');
    response = {
      statusCode: 200,
      body: JSON.stringify({
        message: "Successful run",
        data: {
          numAccountFollowers: numAccountFollowers,
        }
      })
    };
  } catch(err) {
    console.error(`Error ${err}`);
    response = {
      statusCode: 400,
      body: JSON.stringify({
        message: err,
      }),
    };
  } finally {
    callback(null, response);
  }
};

module.exports.getFollowing = async (event, context, callback) => {
  let response = {};
  try {
    const getFollowingAsync = async ({username, password}) => {
      const numAccountsFollowing = await getAccountsFollowing({username, password});
      return numAccountsFollowing;
    }

    dynamoDBHandler.createInstance();
    const username = await dynamoDBHandler.getInstance().getNextUserForFunction('getFollowing');
    if (!username) throw new Error("No username defined for function 'getFollowing'");

    const password = await dynamoDBHandler.getInstance().getPasswordForUser(username);
    if (!password) throw new Error("No password defined for function 'getFollowing'");

    const numAccountsFollowing = await getFollowingAsync({username, password});
    await dynamoDBHandler.getInstance().putTimestampForFunction(username, 'getFollowing');
    response = {
      statusCode: 200,
      body: JSON.stringify({
        message: "Successful run",
        data: {
          numAccountsFollowing: numAccountsFollowing,
        }
      })
    };
  } catch(err) {
    console.error(`Error ${err}`);
    response = {
      statusCode: 400,
      body: JSON.stringify({
        message: err,
      }),
    };
  } finally {
    callback(null, response);
  }
};

module.exports.updateInteractionActivity = async (event, context, callback) => {
  let response = {};
  try {
    const updateInteractionActivityAsync = async ({username, password}) => {
      return await getLatestActivityOfAccounts({username, password});
    }

    dynamoDBHandler.createInstance();
    const username = await dynamoDBHandler.getInstance().getNextUserForFunction('updateInteractionActivity');
    if (!username) throw new Error("No username defined for function 'updateInteractionActivity'");

    const password = await dynamoDBHandler.getInstance().getPasswordForUser(username);
    if (!password) throw new Error("No password defined for function 'updateInteractionActivity'");

    const log = await updateInteractionActivityAsync({username, password});
    response = {
      statusCode: 200,
      body: JSON.stringify({
        message: `Successful run`,
        data: {
          log: log,
        }
      })
    };
  } catch(err) {
    console.error(`Error ${err}`);
    response = {
      statusCode: 400,
      body: JSON.stringify({
        message: err,
      }),
    };
  } finally {
    callback(null, response);
  }
};

module.exports.queuePendingLikeMedia = async (event, context, callback) => {
  let response = {};
  const addPendingLikeMediaToQueueAsync = async ({username, password}) => {
    console.log(`Point 4`);
    const log = await getLatestMediaOfAccounts({username, password});
    console.log(`Point 5`);
    log.concat(await addPendingLikeMediaToQueue({username}));

    return log;
  }

  try {

    console.log(`Point 1`);
    dynamoDBHandler.createInstance();
    console.log(`Point 2`);
    const username = await dynamoDBHandler.getInstance().getNextUserForFunction('queuePendingLikeMedia');
    if (!username) throw new Error("No username defined for function 'queuePendingLikeMedia'");

    const password = await dynamoDBHandler.getInstance().getPasswordForUser(username);
    if (!password) throw new Error("No password defined for function 'addPendingLikeMediaToQueue'");

    console.log(`Point 3`);
    const log = await addPendingLikeMediaToQueueAsync({username, password});
    console.log(`Point 6`);
    response = {
      statusCode: 200,
      body: JSON.stringify({
        message: `Successful run`,
        data: {
          log: log,
        }
      })
    };
  } catch(err) {
    console.error(`Error ${err}`);
    response = {
      statusCode: 400,
      body: JSON.stringify({
        message: err,
      }),
    };
  } finally {
    callback(null, response);
  }
};

module.exports.namedFunctionExection = async (event, context, callback) => {
  // const username = process.env.ACCOUNT;
  // const functionName = process.env.FUNCTION;
  // if (!username) throw new Error("No username defined for function 'namedFunctionExection'");
  // if (!functionName) throw new Error("No functionName defined for function 'namedFunctionExection'");

  // dynamoDBHandler.createInstance();
  // const password = await dynamoDBHandler.getInstance().getPasswordForUser(username);
  // if (!password) throw new Error("No password defined for function 'namedFunctionExection'");

  // switch (functionName) {
  //   case 'addLatestMediaToPendingTable':
  //     dynamoDBHandler.getInstance().addLatestMediaToPendingTable()
  //     break;
  //   default:
  //     throw new Error(`Unknown function ${functionName}`);
  // }
};

module.exports.updateLikedMedia = async (event, context, callback) => {
  let response = {};
  try {
    const updateLikedMediaAsync = async ({username, password}) => {
      return await likedMedia.updateLikedMedia({username, password});
    }

    dynamoDBHandler.createInstance();
    const username = await dynamoDBHandler.getInstance().getNextUserForFunction('addPendingLikeMediaToQueue');
    if (!username) throw new Error("No username defined for function 'addPendingLikeMediaToQueue'");

    const password = await dynamoDBHandler.getInstance().getPasswordForUser(username);
    if (!password) throw new Error("No password defined for function 'addPendingLikeMediaToQueue'");

    const log = await updateLikedMediaAsync({username, password});
    response = {
      statusCode: 200,
      body: JSON.stringify({
        message: `Successful run`,
        data: {
          log: log,
        }
      })
    };
  } catch(err) {
    console.error(`Error ${err}`);
    response = {
      statusCode: 400,
      body: JSON.stringify({
        message: err,
      }),
    };
  } finally {
    callback(null, response);
  }
};
