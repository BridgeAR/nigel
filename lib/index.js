// Load modules

var Events = require('events');
var Stream = require('stream');
var Hoek = require('hoek');
var Vise = require('vise');


// Declare internals

var internals = {};


exports.compile = function (needle) {

    Hoek.assert(needle && needle.length, 'Missing needle');
    Hoek.assert(Buffer.isBuffer(needle), 'Needle must be a buffer');

    var profile = {
        value: needle,
        length: needle.length,
        badCharShift: new Array(256)                    // Lookup table of how many characters can be skipped for each match
    };

    for (var i = 0; i < 256; ++i) {
        profile.badCharShift[i] = profile.length;       // Defaults to the full length of the needle
    }

    var last = profile.length - 1;
    for (i = 0; i < last; ++i) {                        // For each character in the needle (skip last since its position is already the default)
        profile.badCharShift[profile.value[i]] = last - i;
    }

    return profile;
};


exports.horspool = function (haystack, needle, start) {

    Hoek.assert(haystack, 'Missing haystack');

    needle = (needle.badCharShift ? needle : exports.compile(needle));
    start = start || 0;

    for (var pos = start, hlen = haystack.length;
        hlen - pos >= needle.length;                                                        // Has enough room to fit the entire needle
        pos += needle.badCharShift[haystack.readUInt8(pos + needle.length - 1, true)]) {    // Jump to the next possible position based on last character location in needle

        if (haystack.readUInt8(pos + needle.length - 1, true) === needle.value[needle.length - 1] &&
            internals.startsWith(haystack, needle, pos)) {

            return pos;
        }
    }

    return -1;
};


internals.startsWith = function (haystack, needle, pos) {

    if (haystack.startsWith) {
        return haystack.startsWith(needle.value, pos);
    }

    for (var i = 0, il = needle.length - 1; i < il; ++i) {
        if (needle.value[i] !== haystack.readUInt8(pos + i)) {
            return false;
        }
    }

    return true;
};


exports.all = function (haystack, needle, start) {

    needle = exports.compile(needle);
    start = start || 0;

    var matches = [];
    for (var last = start, hlen = haystack.length; last !== -1 && last < hlen;) {

        last = exports.horspool(haystack, needle, last)
        if (last !== -1) {
            matches.push(last);
            last += needle.length;
        }
    }

    return matches;
};


exports.Stream = internals.Stream = function (needle) {

    var self = this;

    Stream.Writable.call(this);

    this._needle = exports.compile(needle);
    this._haystack = new Vise();

    this.on('finish', function () {

        // Flush out the remainder

        var chunks = self._haystack.chunks();
        for (var i = 0, il = chunks.length; i < il; ++i) {
            self.emit('haystack', chunks[i]);
        }
    });
};

Hoek.inherits(internals.Stream, Stream.Writable);


internals.Stream.prototype._write = function (chunk, encoding, next) {

    this._haystack.push(chunk);

    var match = exports.horspool(this._haystack, this._needle);
    if (match === -1 &&
        chunk.length >= this._needle.length) {

        this._flush(this._haystack.length - chunk.length);
    }

    while (match !== -1) {
        this._flush(match);
        this._haystack.shift(this._needle.length);
        this.emit('needle');

        match = exports.horspool(this._haystack, this._needle);
    }

    return next();
};


internals.Stream.prototype._flush = function (pos) {

    var chunks = this._haystack.shift(pos);
    for (var i = 0, il = chunks.length; i < il; ++i) {
        this.emit('haystack', chunks[i]);
    }
};
