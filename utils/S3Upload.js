const s3_bucket = require('../Data/S3Data').s3_bucket;
const s3_config = require('../Data/S3Data').s3_config;
const AWS = require('aws-sdk');
const getExtension = require('./formatFilenames').getExtension;

async function uploadToS3(key, file, progressCallback) {
    return new Promise((resolve, reject) => {
        AWS.config.update(s3_config);

        const extension = getExtension(key);

        let mime;

        if(extension === 'mp4') {
            mime = "video/mp4"
        } else if (extension === 'webm') {
            mime = "video/webm"
        } else if (extension === 'webp') {
            mime = "image/webp"
        } else if (extension === 'png') {
            mime = "image/png"
        }
        else if (extension === 'pdf') {
            mime = "application/pdf"
        } else {
            mime = "application/octet-stream"
        }

        const upload = new AWS.S3.ManagedUpload({
            params: {
                Bucket: s3_bucket,
                Key: key,
                Body: file,
                ContentType: mime,
                ContentDisposition: 'inline',
                CacheControl: 'max-age=604800'
            },
        });

        upload.on('httpUploadProgress', (progress) => {
            const percentage = progress.loaded / progress.total * 100;

            if(progressCallback) {
                progressCallback(percentage);
            }
      
            if (progress.loaded === progress.total) {
              console.log('Upload finished!');
            }
        });

        upload.send((error, data) => {
            if(error) {
                reject(err)
            } else {
                resolve(data)
            }
        });
    });
}

exports.uploadToS3 = uploadToS3;