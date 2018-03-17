const Promise = require('bluebird');
const AWS = require("aws-sdk");
const DynamoDB = Promise.promisifyAll(require("aws-sdk").DynamoDB);
const fs = require('fs');
const _ = require('lodash');
const humps = require('humps');
const moment = require('moment');
const constants = require("../constants");
const dataMarshalService = require("./dataMarshal");

const USER_INITIAL_RECORD = (instagramId, username, isFollowing, isFollower) => ({
  instagramId: instagramId.toString(),
  username,
  lastInteractionAt: 0,
  latestMediaCreatedAt: 0,
  latestMediaId: null,
  latestMediaUrl: null,
  isFollowing,
  isFollower,
  isActive: true,
});

const credentials = new AWS.SharedIniFileCredentials({profile: 'instagrow'});
AWS.config.update({
  region: "us-east-1",
  endpoint: "http://localhost:8000"
});
AWS.config.setPromisesDependency(Promise);
AWS.config.credentials = credentials;


class DynamoDBService {
  constructor(config) {
    this.config = config;
    this.db = new AWS.DynamoDB();
    this.docClient = new AWS.DynamoDB.DocumentClient();
    this.followingInteractionDeltaInDays = config.followingInteractionDeltaInDays || constants.settings.FOLLOWING_INTERACTION_DELTA_IN_DAYS
    this.followerInteractionDeltaInDays = config.hasOwnProperty("followerInteractionDeltaInDays") ? config.followerInteractionDeltaInDays : constants.settings.FOLLOWER_INTERACTION_DELTA_IN_DAYS
    this.userTableName = `Instagrow-${this.config.username}-Users`;
    this.pendingMediaTableName = `Instagrow-${this.config.username}-Media-Pending-Likes`;
  };

  createDB() {
    const CREATE_USERS_TABLE_SCRIPT = {
      TableName : this.userTableName,
      KeySchema: [
        { AttributeName: "instagramId", KeyType: "HASH"}
      ],
      AttributeDefinitions: [
        { AttributeName: "instagramId", AttributeType: "S" }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 1,
        WriteCapacityUnits: 1
      }
    };

    const CREATE_PENDING_MEDIA_TABLE_SCRIPT = {
      TableName : this.pendingMediaTableName,
      KeySchema: [
        { AttributeName: "mediaId", KeyType: "HASH"},
        { AttributeName: "instagramId", KeyType: "RANGE"}
      ],
      AttributeDefinitions: [
        { AttributeName: "mediaId", AttributeType: "S" },
        { AttributeName: "instagramId", AttributeType: "S" }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 1,
        WriteCapacityUnits: 1
      }
    };

    return this.db.createTable(CREATE_USERS_TABLE_SCRIPT).promise()
      .then((data) => {
        console.log("Created table. Table description JSON:", JSON.stringify(data, null, 2));
        return this.db.createTable(CREATE_PENDING_MEDIA_TABLE_SCRIPT).promise()
      })
      .then((data) => {
        console.log("Created table. Table description JSON:", JSON.stringify(data, null, 2));
        return new Promise.resolve(data);
      })
      .catch((err) => {
        console.error("Unable to create table. Error JSON:", JSON.stringify(err, null, 2));
        return new Promise.reject(err);
      });
  }

  deleteDB() {
    return this.db.deleteTable({TableName : this.userTableName}).promise()
      .then((data) => {
        console.log("Deleted table. Table description JSON:", JSON.stringify(data, null, 2));
        return this.db.deleteTable({TableName : this.pendingMediaTableName}).promise();
      })
      .then((data) => {
        console.log("Deleted table. Table description JSON:", JSON.stringify(data, null, 2));
        return new Promise.resolve(data);
      })
      .catch((err) => {
        console.error("Unable to delete table. Error JSON:", JSON.stringify(err, null, 2));
        return new Promise.reject(err);
      });
  }

  createBackup() {
    const backupName = `${this.userTableName}-Bkup-${moment().valueOf()}`
    const backupParams = {
      BackupName: backupName,
      TableName: this.userTableName,
    };

    return this.db.createBackup(backupParams).promise()
      .then(() => {
        console.log(backupName);
        return Promise.resolve(backupName);
      })
  }

  importData() {
    const backupName = `${this.userTableName}-Bkup-${moment().valueOf()}`
    const backupParams = {
      BackupName: backupName,
      TableName: this.userTableName,
    };

    const dataMarshal = new dataMarshalService.service.DataMarshal();
    dataMarshal.importData(`data/dump-${this.config.username}-dynamodb.json`);

    return Promise.map(dataMarshal.records, (record) => {
      const putParams = {
        TableName: this.userTableName,
        Item: record,
      };

      this.docClient.put(putParams, (err, data) => {
        if (err) {
          console.error(`Unable to add user ${record.username} (${record.instagramId}). Error JSON: ${JSON.stringify(err, null, 2)}`);
        } else {
          console.log(`Imported ${record.username} (${record.instagramId})`);
        }
      });
    })
  }

  exportData() {
    return this.db.describeTable({ "TableName": this.userTableName }).promise()
      .then((tableDescription) => {
        console.log("Describe table successful. Table description JSON:", JSON.stringify(tableDescription, null, 2));
        return this.docClient.scan(tableDescription.Table).promise()
          .then((data) => {
            const dataMarshal = new dataMarshalService.service.DataMarshal();
            data.Items.forEach((record) => {
              dataMarshal.addRecord(record)
            })
            dataMarshal.exportData(`data/dump-${this.config.username}-dynamodb.json`);
            return new Promise.resolve(data);
          })
          .catch((err) => {
            return new Promise.reject(err);
          });
      })
      .catch((err) => {
        console.error("Unable to describe table. Error JSON:", JSON.stringify(err, null, 2));
        return new Promise.reject(err);
      });
  }

  getMediaWithLastInteraction() {
    const params = {
      TableName: this.userTableName,
      FilterExpression:
        "lastInteractionAt > :li",
      ExpressionAttributeValues: {
        ":li": 0,
      }
    };

    return this.docClient.scan(params).promise()
      .then((data) => {
        const reducer = (accumulator, item) =>
          item.lastInteractionAt > accumulator.lastInteractionAt ? item : accumulator;

        return new Promise.resolve(
          data.Items && data.Items.reduce(reducer, {lastInteractionAt: 0})
        );
      })
      .catch((err) => {
        return new Promise.reject(err);
      });
  };

  getAccountByInstagramId(instagramId) {
    const params = {
      TableName: this.userTableName,
      Key:{
        instagramId: instagramId.toString(),
      }
    };

    return this.docClient.get(params).promise()
      .then((data) => {
        return new Promise.resolve(data.Item);
      })
      .catch((err) => {
        return new Promise.reject(err);
      });
  };

  getAccountsPossiblyRequiringInteraction() {
    const followerInteractionAgeThreshold = this.followerInteractionDeltaInDays && moment().subtract(this.followerInteractionDeltaInDays, 'd');
    const followingClause = "lastInteractionAt < :lifollowing AND isActive=:true AND isFollowing=:true";
    const followerClause = followerInteractionAgeThreshold ? "lastInteractionAt < :lifollower AND isActive=:true AND isFollower=:true" : "";
    const filterExpression = followerClause ? `(${followingClause}) OR (${followerClause})` : followingClause;
    const expressionAttributeValues = {
      ":lifollowing": moment().subtract(this.followingInteractionDeltaInDays, 'd').valueOf(),
      ":true": true,
    }
    if (followerInteractionAgeThreshold) {
      expressionAttributeValues[":lifollower"] = followerInteractionAgeThreshold.valueOf();
    }
    const params = {
      TableName: this.userTableName,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues,
    };

    return this.docClient.scan(params).promise()
      .then((data) => {
        return new Promise.resolve(data.Items);
      })
      .catch((err) => {
        return new Promise.reject(err);
      });
  };

  getAccountsToBeLiked() {
    const maximumAgeOfContentConsidered = moment().subtract(1, 'w');
    const followingInteractionAgeThreshold = moment().subtract(this.followingInteractionDeltaInDays, 'd');
    const followerInteractionAgeThreshold = this.followerInteractionDeltaInDays && moment().subtract(this.followerInteractionDeltaInDays, 'd');
    const followingClause = "latestMediaCreatedAt > :lmca AND lastInteractionAt < latestMediaCreatedAt AND lastInteractionAt < :lifollowing AND isActive=:true AND isFollowing=:true";
    const followerClause = followerInteractionAgeThreshold ? "latestMediaCreatedAt > :lmca AND lastInteractionAt < latestMediaCreatedAt AND lastInteractionAt < :lifollower AND isActive=:true AND isFollower=:true" : "";
    const filterExpression = followerClause ? `(${followingClause}) OR (${followerClause})` : followingClause;
    const expressionAttributeValues = {
      ":lmca": maximumAgeOfContentConsidered.valueOf(),
      ":lifollowing": followingInteractionAgeThreshold.valueOf(),
      ":true": true,
    }
    if (followerInteractionAgeThreshold) {
      expressionAttributeValues[":lifollower"] = followerInteractionAgeThreshold.valueOf();
    }

    const params = {
      TableName: this.userTableName,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues,
    };

    return this.docClient.scan(params).promise()
      .then((data) => {
        return new Promise.resolve(data.Items);
      })
      .catch((err) => {
        return new Promise.reject(err);
      });
   };

  updateFollowerAccountsToInactive() {
    const scanParams = {
      TableName: this.userTableName,
      FilterExpression: "isFollower=:true",
      ExpressionAttributeValues: {
        ":true": true,
      }
    };

    const updateParams = (instagramId) => ({
      TableName: this.userTableName,
      Key: {instagramId: instagramId},
      UpdateExpression: "set isActive = :false, isFollower = :false",
      ExpressionAttributeValues:{
        ":false": false,
      },
      ReturnValues:"UPDATED_NEW",
    });

    return this.docClient.scan(scanParams).promise()
      .then((data) => Promise.map(data.Items, (account) => this.docClient.update(
        updateParams(account.instagramId.toString()))
      ));
  }

  updateFollowingAccountsToInactive() {
    const scanParams = {
      TableName: this.userTableName,
      FilterExpression: "isFollowing=:true",
      ExpressionAttributeValues: {
        ":true": true,
      }
    };

    const updateParams = (instagramId) => ({
      TableName: this.userTableName,
      Key: {instagramId: instagramId},
      UpdateExpression: "set isActive = :false, isFollowing = :false",
      ExpressionAttributeValues:{
        ":false": false,
      },
      ReturnValues:"UPDATED_NEW",
    });

    return this.docClient.scan(scanParams).promise()
      .then((data) => Promise.map(data.Items, (account) => this.docClient.update(
        updateParams(account.instagramId.toString()))
      ));
  }

  addFollowersAccountOrUpdateUsername(instagramId, username) {
    return this.getAccountByInstagramId(instagramId)
      .then((account) => {
        if (account) {
          const params = {
            TableName: this.userTableName,
            Key: {instagramId: instagramId.toString()},
            UpdateExpression: "set username = :u, isFollower = :true, isActive = :true",
            ExpressionAttributeValues:{
              ":u": username,
              ":true": true,
            },
            ReturnValues:"UPDATED_NEW"
          };
          return this.docClient.update(params).promise()
            .then(() => {
              return new Promise.resolve({instagramId: instagramId, username: username})
            });
        } else {
          const params = {
            TableName: this.userTableName,
            Item: USER_INITIAL_RECORD(instagramId, username, false, true)
          };
          return this.docClient.put(params).promise()
            .then(() => {
              return new Promise.resolve({instagramId: instagramId, username: username})
            });
        }
      })
  }

  addFollowingAccountOrUpdateUsername(instagramId, username) {
    return this.getAccountByInstagramId(instagramId)
      .then((account) => {
        if (account) {
          const params = {
            TableName: this.userTableName,
            Key: {instagramId: instagramId.toString()},
            UpdateExpression: "set username = :u, isFollowing = :true, isActive = :true",
            ExpressionAttributeValues:{
              ":u": username,
              ":true": true,
            },
            ReturnValues:"UPDATED_NEW"
          };
          return this.docClient.update(params).promise()
            .then(() => {
              return new Promise.resolve({instagramId: instagramId, username: username})
            });
        } else {
          const params = {
            TableName: this.userTableName,
            Item: USER_INITIAL_RECORD(instagramId, username, true, false)
          };
          return this.docClient.put(params).promise()
            .then(() => {
              return new Promise.resolve({instagramId: instagramId, username: username})
            });
        }
      })
  }

  addLatestMediaToPendingTable(instagramId, mediaId, mediaUrl, username) {
    const params = {
      TableName: this.pendingMediaTableName,
      Item: {
        instagramId: instagramId.toString(),
        mediaId,
        mediaUrl,
        username,
      },
    };
    return this.docClient.put(params).promise()
      .then(() => {
        return new Promise.resolve({instagramId, mediaId})
      });
  }

  getLatestMediaFromPendingTable(limit=null) {
    const params = {
      TableName: this.pendingMediaTableName,
    };
    if (limit) {
      params['Limit'] = limit;
    }
    return this.docClient.scan(params).promise()
      .then((data) => {
        return new Promise.resolve(data.Items)
      });
  }

  deleteMediaFromPendingTable(instagramId, mediaId) {
    const params = {
      TableName: this.pendingMediaTableName,
      Key: {
        instagramId,
        mediaId,
      }
    };
    return this.docClient.delete(params).promise()
      .then((data) => {
        return new Promise.resolve(data.Items)
      });
  }

  updateLatestMediaDetails(instagramId, latestMediaId, latestMediaUrl, latestMediaCreatedAt) {
    const params = {
      TableName: this.userTableName,
      Key: {instagramId: instagramId.toString()},
      UpdateExpression: "set latestMediaId = :lmi, latestMediaUrl = :lmu, latestMediaCreatedAt = :lmca",
      ExpressionAttributeValues:{
        ":lmi": latestMediaId,
        ":lmu": latestMediaUrl,
        ":lmca": latestMediaCreatedAt,
      },
      ReturnValues:"UPDATED_NEW"
    };
    return this.docClient.update(params).promise()
      .then(() => new Promise.resolve({instagramId: instagramId}));
  }

  updateLastInteration(instagramId, latestInteraction) {
    const params = {
      TableName: this.userTableName,
      Key: {instagramId: instagramId.toString()},
      UpdateExpression: "set lastInteractionAt = :li",
      ExpressionAttributeValues:{
        ":li": latestInteraction,
      },
      ReturnValues:"UPDATED_NEW"
    };
    return this.docClient.update(params).promise()
      .then(() => new Promise.resolve({instagramId: instagramId}));
  }

  close() {}
}

let instance = null;
const createInstance = (config) => {
  instance = new DynamoDBService(config);
  return instance;
}
const getInstance = () => instance;

exports.handler = {
  createInstance,
  getInstance,
};
