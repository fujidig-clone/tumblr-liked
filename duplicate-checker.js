var SIMILARITY_THRESHOLD = 0.2;

function DuplicateChecker(gui) {
	this.gui = gui;
	this.outputElem = null;
}

DuplicateChecker.start = function(gui) {
	new DuplicateChecker(gui).start();
};

DuplicateChecker.prototype.start = function() {
	var xml = <div id="duplicate-checker">
		<h2>Duplicate Checker</h2>
		<p class="status"/>
		<div class="result"/>
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

DuplicateChecker.prototype.collectImages = function() {
	var self = this;
	return this.collectBlogImagesAndBuildFinder().addCallback(function ([finder, blogPosts]) {
		return self.loadLikedImages().addCallback(function (likedImages) {
			return [finder, blogPosts, likedImages];
		});
	});
}

DuplicateChecker.prototype.loadLikedImages = function() {
	var list = [];
	var result = [];
	this.gui.posts.forEach(function (post, i) {
		result[i] = [];
		detectThumbnailURLs(post.postElem).forEach(function (url, j) {
			list.push(loadImage(url).addCallback(function (binary) {
				result[i][j] = binary;
			}));
		})
	});
	return doParallel(list).addCallback(function () result);
};

DuplicateChecker.prototype.checkDuplicate = function([finder, blogPosts, likedImages]) {
	this.changeStatus("checking duplicate");
	var result = this.findDuplicate(finder, this.gui.posts, likedImages);
	var output = <div/>;
	result.forEach(function(res) {
		detectThumbnailURLs(res.likedPost.postElem).forEach(function(url) {
			output.appendChild(<img src={url}/>);
		});
		res.blogPost.getThumbnailURLs().forEach(function(url) {
			output.appendChild(<img src={url}/>);
		});
		output.appendChild(<br/>);
	});
	replaceElemChild(this.outputElem.querySelector("div.result"), this.gui.toDOM(output.children()));
	finder.close();
};

DuplicateChecker.prototype.findDuplicate = function(finder, likedPosts, likedImages) {
	var likedPosts = this.gui.posts;
	var result = [];
	likedPosts.forEach(function (likedPost, index) {
		likedImages[index].forEach(function (image) {
			finder.findByBinary(image, SIMILARITY_THRESHOLD).forEach(function (res) {
				result.push({dist: res.dist,
				             likedPost: likedPost,
				             blogPost: res.image.meta.post});
			});
		});
	});
	return result;
};

DuplicateChecker.prototype.changeStatus = function(text) {
	replaceElemText(this.outputElem.querySelector("p.status"), text);
};

DuplicateChecker.prototype.collectBlogImagesAndBuildFinder = function() {
	var finder = new SimilarImageFinder();
	return readBlogPosts(Config.blogName).addCallback(function (posts) {
		var images = [];
		Array.forEach(posts, function (post) {
			post.getThumbnailURLs().forEach(function (imageUrl) {
				images.push([post, imageUrl]);
			});
		});
		var list = images.map(function ([post, imageUrl]) {
			liberator.log(imageUrl);
			return loadImage(imageUrl)
				.addCallback(function (binary) {
					var meta = {imageUrl: imageUrl, post: post};
					finder.add(meta, binary);
				});
		});
		return new DeferredList(list, false, true, false).addCallback(function() {
			return [finder, posts];
		});
	});
}
