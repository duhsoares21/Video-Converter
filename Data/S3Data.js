const s3_bucket = 'myhotspace';
const s3_region = 'us-east-1';
const s3_accessKey = 'AKIA5XVIABF6VHBW2Q3N';
const s3_secretKey = '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';

const s3_config = {
    region: s3_region,
    credentials: {
        accessKeyId: s3_accessKey,
        secretAccessKey: s3_secretKey,
    },
}

exports.s3_bucket       = s3_bucket
exports.s3_config       = s3_config
exports.s3_accessKey    = s3_accessKey
exports.s3_secretKey    = s3_secretKey