const uploadToS3 = require('./utils/S3Upload').uploadToS3;

const ACCESS_KEY = require('./Data/S3Data').s3_accessKey;
const SECRET_KEY = require('./Data/S3Data').s3_secretKey;

const os = require('os');
const path = require('path');

const sharp = require('sharp');

const express = require('express');
const fs = require('fs');

const AWS = require('aws-sdk');

const app = express();
const port = 9000;

const { default: axios } = require('axios');

axios.defaults.baseURL = "https://api.myhotspace.co/api/";
const { NEXT_QUEUE } = require('./Data/endpoints');

const ffmpeg = require('fluent-ffmpeg');

const s3 = new AWS.S3({
  accessKeyId: ACCESS_KEY,
  secretAccessKey: SECRET_KEY,
  region: 'us-east-1',
});

app.use(express.json());

//Recebe uma key e faz o stream de um vídeo a partir do S3
app.get('/stream', async (req, res) => {
  const key = req.query.key;

  console.log("A", key)

  const stream = await CreateStreamFromS3(key); 
  const { ContentLength } = await getS3ObjectMetadata(key);

  res.setHeader('Cache-Control', 'no-store'); // Disable caching
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', 0);

  // Get the range header from the request
  const range = req.headers.range;

  if (range) {
    // Parse the range header
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : ContentLength - 1;

    // Set the byte range in the S3 params
    const params = {
      Bucket: 'myhotspace',
      Key: key,
      Range: `bytes=${start}-${end || ''}`,
    };

    // Get a readable stream for the specified range
    const file = await s3.getObject(params).createReadStream();

    // Set the appropriate headers for a partial response
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${ContentLength}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/webm',
    });

    // Pipe the file stream to the response
    file.pipe(res);
  } else {
    // No range header, serve the entire video
    res.setHeader('Content-Type', 'video/webm');
    res.setHeader('Content-Length', ContentLength);

    // Pipe the entire stream to the response
    stream.pipe(res);
  }
});

// Function to get S3 object metadata
function getS3ObjectMetadata(key) {
  const params = { Bucket: 'myhotspace', Key: key }; // Update with your bucket name
  return s3.headObject(params).promise();
}

//Inicia o servidor
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  ConvertVideo();
});

async function ConvertVideo() {
    try {

      const data = (await axios.get(NEXT_QUEUE)).data;

      if(!data.payload.hasOwnProperty("errors")) {
        const id_video = data.payload.id;
        const upload_path = data.payload.upload_path;
        
        const key = upload_path;
    
        if(key !== null) {

          await axios.patch("/videos/updateProcessing/"+id_video, {
            "processed_status": 2
          });

          const length = key.split("/").length;
          const fileName = key.split("/")[length-1];
              
          const s3Params = {
            Bucket: 'myhotspace',
            Key: key,
          };

          const tempFilePath = path.join(os.tmpdir(), `${id_video}-${fileName}`);
          const tempFileWriteStream = fs.createWriteStream(tempFilePath);

          const s3Stream = s3.getObject(s3Params).createReadStream();

          s3Stream.on('error', (err) => {
            console.error('Error reading from S3:', err);
            // Handle the error, e.g., call ConvertVideo() again
            ConvertVideo();
          });

          s3Stream.pipe(tempFileWriteStream);

          tempFileWriteStream.on('error', (err) => {
            console.error('Error creating write stream:', err);
            // Handle the error, e.g., call ConvertVideo() again
            ConvertVideo();
          });
      
          tempFileWriteStream.on('finish', async () => {

            fs.stat(tempFilePath, (err, stats) => {
              if (err) {
                console.error('Error getting file stats:', err);
                ConvertVideo();
              } else {
                console.log('Input File Size:', stats.size);
              }
            });

            const videoStream = ffmpeg().input(tempFilePath);
            videoStream
            .format('webm')
            .videoCodec('libvpx')
            .audioCodec('libopus')
            .audioChannels(2)
            .outputOptions(
              [
                '-quality good', 
                '-speed 0', 
                '-crf 33', 
                '-b:v 5000k', 
                '-b:a 128k', 
              ])
            .on('progress', (progress) => {
              console.log(`Processing: ${progress.percent}% done`);
            })
            .on('end', async () => {
              console.log('Conversion finished');

              fs.unlink(tempFilePath, (err) => {
                if (err) {
                  console.error('Error deleting temporary file:', err);
                } else {
                  console.log('Temporary file deleted successfully');
                }
              });
            })
            .on('error', (err, stdout, stderr) => {
              console.error('Error:', err);
              console.error('ffmpeg stdout:', stdout);
              console.error('ffmpeg stderr:', stderr);
            });
      
            await UploadVideo(id_video, false, fileName+'.webm', videoStream.stream(), key);
          });
        } else {
          console.log("NENHUM VIDEO PARA CONVERTER")
          setTimeout(ConvertVideo, (1000 * 60) * 5);
        }
      } else {
        console.log("NENHUM VIDEO PARA CONVERTER")
        setTimeout(ConvertVideo, (1000 * 60) * 5);
      }
  
    } catch (error) {
      console.error('Error Converting:', error);
      ConvertVideo();
    }
}

async function CreateStreamFromS3(key) {
  const s3Params = {
    Bucket: 'myhotspace',
    Key: key,
  };

  const s3Stream = s3.getObject(s3Params).createReadStream();   

  return s3Stream;
}

async function UploadImage(filename, file) {
  sharp(file)
  .webp()
  .toBuffer()
  .then(data => {

    const prefix = 'teste/converted/pictures/';
    const uploadManager = uploadToS3(prefix+filename+'.webp', data);

    uploadManager.on('httpUploadProgress', function(evt) {
      const percentual = (evt.loaded * 100) / evt.total;        
      console.log("Uploaded :: " + percentual +'%');
    })
  })
  .catch(err => {
    console.error(err);
  });
}

async function UploadVideo(id_video, original, filename, file, upload_key) {
  const prefix = original ? 'videos/album/' : 'videos/converted/';
  
  try {
    await uploadToS3(prefix+filename, file, (percentage) => {
      console.log(`Progresso: ${percentage}%`);
    })

    await axios.patch("/videos/updateProcessing/"+id_video, {
      "processed_status": 1
    });

    await axios.patch("/videos/path/"+id_video, {
      "path": prefix+filename
    });

    ConvertVideo();
  } catch (error) {
    ConvertVideo();
    console.log("CONVERSION ERROR", error);
  }
}

async function UploadThumbnail(filename, file, videoKey) {
  const prefix = 'teste/converted/thumbnails/';
  await uploadToS3(prefix+filename, file);

  saveVideo(prefix+filename, videoKey);
}

function generateThumbnail(inputVideoPath, thumbnailTime, filename, videoKey) {

  ffmpeg()
  .input(inputVideoPath)
  .screenshots({
    count: 1,
    timemarks: [thumbnailTime],
    folder: 'thumbnails',
    filename: filename + '.jpg',
    size: '320x240',
  })
  .on('progress', function (progress) {
    console.log(progress);
    console.log('Processing: ' + progress.percent + '% done');
  })
  .on('error', function (err) {
    console.error('Error:', err);
  })
  .on('end', function () {
    UploadThumbnail(filename+'.jpg',fs.createReadStream('thumbnails/'+filename+'.jpg'), 'teste/original/'+filename);
    console.log('Processing finished!');
  });
}