const StatsD = require('node-statsd');
const AWS = require('aws-sdk');
const https = require('https');

const model = require('./models/index.js');

const statsd = new StatsD({ host: 'statsd', port: 8125 });

const agent = new https.Agent({ maxSockets: 99999 });
AWS.config.update({ region: 'us-west-1', httpOptions: { agent } });

const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });

const QueueUrl = process.env.VIDEOS_QUEUE_URL;

const receiveParams = {
  AttributeNames: [
    'SentTimestamp',
  ],
  MaxNumberOfMessages: 10,
  MessageAttributeNames: [
    'All',
  ],
  QueueUrl,
  VisibilityTimeout: 30,
  WaitTimeSeconds: 20,
};

const processMessage = function processMessagesToModels(message) {
  const sendParams = {
    MessageBody: '',
    QueueUrl: '',
    DelaySeconds: 0,
  };

  if (message.route === '/videos') {
    if (message.method === 'GET') {
      return model.list(message.data)
        .then((data) => {
          sendParams.MessageBody = JSON.stringify({ id: message.id, data });
          sendParams.QueueUrl = message.resUrl;
          sqs.sendMessage(sendParams, (err) => {
            if (err) console.log(err);
          });
        })
        .catch((data) => {
          sendParams.MessageBody = JSON.stringify({ id: message.id, data });
          sendParams.QueueUrl = message.resUrl;
          sqs.sendMessage(sendParams, (err, res) => {
            if (err) console.log(err);
            else console.log(res);
          });
        });
    } else if (message.method === 'POST') {
      return model.insert(message.data)
        .then((data) => {
          sendParams.MessageBody = JSON.stringify({ data });
          sendParams.QueueUrl = process.env.ENTRY_QUEUE_URL;
          sqs.sendMessage(sendParams, (err) => {
            if (err) console.log(err);
          });
          sendParams.QueueUrl = process.env.RELATED_QUEUE_URL;
          sqs.sendMessage(sendParams, (err) => {
            if (err) console.log(err);
          });
        });
    }
  } else if (message.route === '/videos/views') {
    if (message.method === 'PUT') {
      return model.views(message.data);
    }
  }

  return Promise.reject();
};

const receive = function receiveFromQueue() {
  sqs.receiveMessage(receiveParams, (err, data) => {
    if (err) {
      console.log('Error: ', err);
      receive();
    } else if (data.Messages) {
      const deleteBatchParams = {
        Entries: [],
        QueueUrl,
      };

      data.Messages.forEach((message) => {
        const deleteParams = {
          Id: message.MessageId,
          ReceiptHandle: message.ReceiptHandle,
        };

        const start = new Date();
        processMessage(JSON.parse(message.Body))
          .then(() => statsd.timing('response_time', new Date() - start));

        deleteBatchParams.Entries.push(deleteParams);
      });

      sqs.deleteMessageBatch(deleteBatchParams);

      receive();
    } else {
      receive();
    }
  });
};

for (let i = 0; i < 1; i += 1) {
  setTimeout(() => receive(), 0);
}
