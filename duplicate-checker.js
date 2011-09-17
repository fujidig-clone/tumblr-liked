var SIMILARITY_THRESHOLD = 0.2;

function DuplicateChecker(gui) {
	this.gui = gui;
	this.tumblr = gui.tumblr;
	this.outputElem = null;
}

DuplicateChecker.start = function(gui) {
	new DuplicateChecker(gui).start();
};

DuplicateChecker.prototype.start = function() {
	var xml = <div id="duplicate-checker">
		<h2>Duplicate Checker</h2>
		<p class="status"/>
		<table class="result"/>
	</div>;
	var style = <style type="text/css">
		/*<![CDATA[*/
		#duplicate-checker {
			border: 1px solid black;
			margin: 5px;
			padding: 5px;
		}
		/*]]>*/
	</style>
	var doc = this.gui.doc;
	var h1 = doc.querySelector("h1");
	this.outputElem = util.xmlToDom(xml, doc);
	h1.parentNode.insertBefore(this.outputElem, h1.nextSibling);
	doc.documentElement.appendChild(util.xmlToDom(style, doc));
	this.changeStatus("collectings images...");
	this.collectImages().addCallback(this.checkDuplicate.bind(this)).addErrback(liberator.echoerr);
};

DuplicateChecker.prototype.checkDuplicate = function(finder) {
	this.changeStatus("checking duplicate");
	return Async.callLater(0, this.checkDuplicate0.bind(this, finder));
};

DuplicateChecker.prototype.checkDuplicate0 = function (finder) {
	var ignore = function (image1, image2) {
		return image1.meta.source === "blog" && image2.meta.source === "blog";
	};
	var result = finder.findAll(SIMILARITY_THRESHOLD, ignore);
	finder.puzzle.close();
	this.changeStatus("loading post data");
	return this.loadPostsOfResult(result).addCallback(this.showResult.bind(this));
};

DuplicateChecker.prototype.showResult = function (result) {
	if (result.length === 0) {
		this.changeStatus("duplicate images not found");
	} else {
		this.changeStatus("found duplicate images");
	}
	var output = <tbody/>;
	result.forEach(function([image1, image2, dist]) {
		var tr = <tr><td/><td/></tr>;
		output.appendChild(tr);
		[image1, image2].forEach(function (image, i) {
			var post = image.meta.post;
			var source = image.meta.source;
			td = tr.td[i];
			var a = <a href={post.post_url}/>;
			td.appendChild(a);
			post.getThumbnailURLs().forEach(function(url) {
				a.appendChild(<img src={url}/>);
			});
			td.appendChild(<br/>);
			td.appendChild(<>{source}<br/></>);
			td.appendChild(<>{post.reblog_key}<br/></>);
			post.getPhotos().forEach(function (photo) {
				td.appendChild(<a href={photo.url}>{photo.width}x{photo.height}</a>);
				td.appendChild(" ");
			});
		});
	});
	replaceElemChild(this.outputElem.querySelector("table.result"), this.gui.toDOM(output));
};

DuplicateChecker.prototype.changeStatus = function(text) {
	replaceElemText(this.outputElem.querySelector("p.status"), text);
};

DuplicateChecker.prototype.collectImages = function() {
	var puzzle = Puzzle.open();
	var finder = new SimilarImageFinder(puzzle);
	var d = Async.succeed();
	d.addCallback(this.addBlogImages.bind(this, finder));
	d.addCallback(this.addLikedImages.bind(this, finder));
	d.addCallback(function() finder);
	return d;
}

DuplicateChecker.prototype.addLikedImages = function(finder) {
	var list = [];
	this.gui.guiPosts.forEach(function (guiPost, i) {
		var post = guiPost.post;
		post.getThumbnailURLs().forEach(function (url, j) {
			list.push(loadImage(url).addCallback(function (binary) {
				var meta = {imageUrl: url, post: post, source: "liked"};
				finder.add(meta, binary);
			}));
		})
	});
	return doParallel(list);
};

DuplicateChecker.prototype.addBlogImages = function(finder) {
	var d = new BlogImageCollector(this.tumblr, finder.puzzle).collect();
	return d.addCallback(function (images) {
		images.forEach(function (image) {
			var meta = {postId: image.id,
			            post: null,
			            source: "blog"};
			finder.addByCvec(meta, image.cvec);
		});
	});
};

DuplicateChecker.prototype.loadPostsOfResult = function (result) {
	var self = this;
	var metas = [];
	result.forEach(function ([image1, image2, dist]) {
		[image1, image2].forEach(function (image) {
			var meta = image.meta;
			if (meta.source === "blog")
				metas.push(meta);
		});
	});
	return loop(0);
	function loop(index) {
		if (index >= metas.length)
			return Async.succeed(result);
		var meta = metas[index];
		var d = self.tumblr.readBlogPost(Config.baseHostname, meta.postId);
		return d.addCallback(function (post) {
			meta.post = post;
			return loop(index + 1);
		});
	}
};

var BlogImageCollector = function(tumblr, puzzle) {
	this.tumblr = tumblr;
	this.puzzle = puzzle;
};

BlogImageCollector.Image = function (id, cvec) {
	this.id = id;
	this.cvec = cvec;
};

BlogImageCollector.Image.prototype.encode = function (puzzle) {
	return {id: this.id,
		cvec: window.btoa(puzzle.compressCvec(this.cvec))};
};

BlogImageCollector.Image.decode = function (puzzle, data) {
	var cvec = puzzle.uncompressCvec(window.atob(data.cvec));
	return new BlogImageCollector.Image(data.id, cvec);
};

BlogImageCollector.prototype.collect = function () {
	var puzzle = this.puzzle;
	var store = storage.newMap("tumblrliked-blog-images", {store: true});
	var storedData = store.get("data") || [];
	var storedIds = storedData.map(function (x) x.id);
	return this.loadUnstored(storedIds).addCallback(function (latestImages) {
		liberator.log("number of latest images is "+latestImages.length);
		var latestData = latestImages.map(function (x) x.encode(puzzle));
		store.set("data", Array.concat(latestData, storedData));
		store.save();

		var storedImages = storedData.map(function (data) {
			return BlogImageCollector.Image.decode(puzzle, data);
		});
		return Array.concat(latestImages, storedImages);
	});
};

BlogImageCollector.prototype.loadUnstored = function (storedIds) {
	var self = this;
	var results = [];
	var predicate = function (post) storedIds.indexOf(post.id) >= 0;
	var d = this.tumblr.readBlogPostsWithPredicate(Config.baseHostname, predicate);
	return d.addCallback(function (posts) {
		var images = [];
		Array.forEach(posts, function (post) {
			post.getThumbnailURLs().forEach(function (imageUrl) {
				images.push([post, imageUrl]);
			});
		});
		var list = images.map(function ([post, imageUrl], i) {
			//liberator.log(imageUrl);
			return loadImage(imageUrl).addCallback(function (binary) {
				var cvec = self.puzzle.createCvecFromImageBinary(binary);
				results[i] = new BlogImageCollector.Image(post.id, cvec);
			});
		});
		return doParallel(list);
	}).addCallback(function () results);
};
