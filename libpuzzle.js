Components.utils.import("resource://gre/modules/ctypes.jsm", this);
var LIBPUZZLE_PATH = "/usr/local/lib/libpuzzle.so";

function SimilarImageFinder(puzzle) {
	this.images = [];
	this.puzzle = puzzle;
}

SimilarImageFinder.prototype.add = function(meta, binary) {
	var cvec = this.puzzle.createCvecFromImageBinary(binary);
	return this.addByCvec(meta, binary);
};

SimilarImageFinder.prototype.addByCvec = function (meta, cvec) {
	var image = {meta: meta, cvec: cvec, index: this.images.length};
	this.images.push(image);
	return image;
};

SimilarImageFinder.prototype.calcDistance = function(cvec1, cvec2) {
	return this.puzzle.vectorNormalizedDistance(cvec1, cvec2);
};

SimilarImageFinder.prototype.findAll = function (threshold, ignorePredicate) {
	var images = this.images;
	var self = this;
	var results = [];
	images.forEach(function (image, i) {
		for (var j = i + 1; j < images.length; j ++) {
			var other = images[j];
			if (ignorePredicate(image, other)) continue;
			var dist = self.calcDistance(image.cvec, other.cvec);
			if (dist < threshold) {
				results.push([image, other, dist]);
				break;
			}
		}
	});
	return results;
};

SimilarImageFinder.prototype.find = function (image, threshold) {
	return this.findByCvec(image.cvec, threshold)
		.filter(function(result) result.image != image);
};

SimilarImageFinder.prototype.findByBinary = function (binary, threshold) {
	var cvec = this.puzzle.createCvecFromImageBinary(binary);
	return this.findByCvec(cvec, threshold);
};

SimilarImageFinder.prototype.findByCvec = function(cvec, threshold) {
	var self = this;
	return this.images
		.map(function (other) {
			var dist = self.calcDistance(cvec, other.cvec);
			return {dist: dist, image: other};
		})
		.filter(function (result) result.dist < threshold);
};

function Puzzle(libpuzzle) {
	this.libpuzzle = libpuzzle;
	this.declareFunctions();
	this.puzzleContext = new PuzzleContext();
	this._init_context();
}

Puzzle.open = function () {
	var libpuzzle = ctypes.open(LIBPUZZLE_PATH);
	return new Puzzle(libpuzzle);
};

Puzzle.prototype.close = function() {
	this._free_context();
	this.libpuzzle.close();
};

Puzzle.prototype.createCvecFromImageBinary = function (bytes) {
	var self = this;
	var UcharArray = ctypes.unsigned_char.array();
	var array = new UcharArray(Array.slice(bytes));
	return this.newCvec(function (puzzleCvec) {
		var ret = self._fill_cvec_from_mem(P(puzzleCvec), P(array), array.length);
		if (ret !== 0) throw "failed to create cvec";
	});
};

Puzzle.prototype.newCvec = function(callback) {
	var cvec = new PuzzleCvec();
	this._init_cvec(P(cvec));
	callback(cvec);
	var vec = copyArray(cvec.vec, cvec.sizeof_vec);
	this._free_cvec(P(cvec));
	return new Cvec(vec);
};

Puzzle.prototype.vectorNormalizedDistance = function(cvec1, cvec2) {
	return this._vector_normalized_distance(
		P(cvec1.createPuzzleCvec()),
		P(cvec2.createPuzzleCvec()),
		0);
};

Puzzle.prototype.compressCvec = function (cvec) {
	var puzzleCvec = cvec.createPuzzleCvec();
	var compressedCvec = new PuzzleCompressedCvec();
	this._init_compressed_cvec(P(compressedCvec));
	this._compress_cvec(P(compressedCvec), P(puzzleCvec));
	var data = copyArray(compressedCvec.vec, compressedCvec.sizeof_compressed_vec);
	this._free_compressed_cvec(P(compressedCvec));
	return String.fromCharCode.apply(null, data);
};

Puzzle.prototype.uncompressCvec = function (string) {
	var self = this;
	var charCodes = string.split("").map(function (x) x.charCodeAt(0));
	var array = ctypes.unsigned_char.array()(charCodes);
	var compressedCvec = new PuzzleCompressedCvec();
	compressedCvec.vec = ctypes.cast(P(array), ctypes.unsigned_char.ptr);
	compressedCvec.sizeof_compressed_vec = array.length;
	return this.newCvec(function (cvec) {
		self._uncompress_cvec(P(compressedCvec), P(cvec));
	});
};

function Cvec(vec) {
	this.vec = vec;
}

Cvec.prototype.createPuzzleCvec = function() {
	return new PuzzleCvec(this.vec.length, this.vec);
};


Puzzle.prototype.declareFunctions = function() {
	var self = this;
	declare("puzzle_init_context", ctypes.void_t, []);
	declare("puzzle_free_context", ctypes.void_t, []);
	declare("puzzle_init_cvec", ctypes.void_t, [PuzzleCvec.ptr]);
	declare("puzzle_free_cvec", ctypes.void_t, [PuzzleCvec.ptr]);
	declare("puzzle_fill_cvec_from_mem", ctypes.int, [PuzzleCvec.ptr, ctypes.void_t.ptr, ctypes.size_t]);
	declare("puzzle_vector_normalized_distance", ctypes.double, [PuzzleCvec.ptr, PuzzleCvec.ptr, ctypes.int]);
	declare("puzzle_init_compressed_cvec", ctypes.void_t, [PuzzleCompressedCvec.ptr]);
	declare("puzzle_free_compressed_cvec", ctypes.void_t, [PuzzleCompressedCvec.ptr]);
	declare("puzzle_compress_cvec", ctypes.int, [PuzzleCompressedCvec.ptr, PuzzleCvec.ptr]);
	declare("puzzle_uncompress_cvec", ctypes.int, [PuzzleCompressedCvec.ptr, PuzzleCvec.ptr]);

	function declare(name, returnValueType, argsType) {
		var internal = getFunc(name, returnValueType, argsType);
		var newName = name.replace(/^puzzle_/, "_");
		self[newName] = function() {
			var args = [P(this.puzzleContext)].concat(Array.slice(arguments));
			// FunctionType.ptr には apply とか定義されていないので
			// 可変長の引数を渡すには現状evalしかないっぽい
			var s = "internal(" + args.map(function(arg, i) "args["+i+"]").join(", ") + ")";
			return eval(s);
		};
	}
	function getFunc(name, returnValueType, argTypes) {
		var libpuzzle = self.libpuzzle;
		var args = [name, ctypes.default_abi, returnValueType, PuzzleContext.ptr].concat(argTypes);
		return libpuzzle.declare.apply(libpuzzle, args);
	}
};

var PuzzleDvec = new ctypes.StructType("PuzzleDvec", [
	{sizeof_vec: ctypes.size_t},
	{sizeof_compressed_vec: ctypes.size_t},
	{vec: ctypes.double.ptr},
]);

var PuzzleCvec = new ctypes.StructType("PuzzleCvec", [
	{sizeof_vec: ctypes.size_t},
	{vec: ctypes.signed_char.ptr},
]);

var PuzzleCompressedCvec = new ctypes.StructType("PuzzleCompressedCvec", [
	{sizeof_compressed_vec: ctypes.size_t},
	{vec: ctypes.unsigned_char.ptr},
]);

var PuzzleContext = new ctypes.StructType("PuzzleContext", [
	{puzzle_max_width: ctypes.unsigned_int},
	{puzzle_max_height: ctypes.unsigned_int},
	{puzzle_lambdas: ctypes.unsigned_int},
	{puzzle_p_ratio: ctypes.double},
	{puzzle_noise_cutoff: ctypes.double},
	{puzzle_contrast_barrier_for_cropping: ctypes.double},
	{puzzle_max_cropping_ratio: ctypes.double},
	{puzzle_enable_autocrop: ctypes.int},
	{magic: ctypes.unsigned_long},    
]);

function copyArray(pointer, num) {
	var array = ctypes.cast(pointer, pointer.constructor.targetType.array(num).ptr).contents;
	return new array.constructor(array);
}

function P(obj) { return obj.address(); }

