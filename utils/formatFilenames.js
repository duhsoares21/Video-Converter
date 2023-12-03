function getExtension(filename) {
    return filename.slice((Math.max(0, filename.lastIndexOf(".")) || Infinity) + 1);
}

exports.getExtension = getExtension