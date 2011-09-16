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
	}
	var result = finder.findAll(SIMILARITY_THRESHOLD, ignore);
	finder.close();
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
	var finder = new SimilarImageFinder();
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
	return this.tumblr.readBlogPosts(Config.baseHostname).addCallback(function (posts) {
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
					var meta = {imageUrl: imageUrl, post: post, source: "blog"};
					finder.add(meta, binary);
				});
		});
		return new DeferredList(list, false, true, false);
	});
}
