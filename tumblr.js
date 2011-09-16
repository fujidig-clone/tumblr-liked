var RECENTLY_BLOG_POSTS_NUM = 20;

function Tumblr() {
	this.api = new TumblrAPI(Config.oauthAccessor);
}

Tumblr.prototype.readLikedPosts = function (num) {
	var predicate = function(allPosts, post) allPosts.length >= num;
	return this.readLikedPostsGeneric(predicate);
};

// ブログの最近のリブログのポストにぶちあたるまでのpostを集める
Tumblr.prototype.readLikedPostsUntilEncounterReblogged = function () {
	var self = this;
	return this.readBlogPosts(Config.baseHostname, RECENTLY_BLOG_POSTS_NUM).addCallback(function (posts) {
		var keysRegexp = genRegexp(posts.map(function (post) post.reblog_key));
		var terminatePredicate = function(allPosts, post) {
			return keysRegexp.test(post.reblog_key);
		}
		return self.readLikedPostsGeneric(terminatePredicate);
	});
}

// こっちはブログとlikedを最後のページまでアクセスして正確に未リブログだけを集める
Tumblr.prototype.readLikedPostsNotReblogged = function () {
	return this.readBlogPosts(Config.baseHostname).addCallback(function (posts) {
		var keysRegexp = genRegexp(posts.map(function (post) post.reblog-key));
		var terminatePredicate = function(allPosts, post) false;
		var rejectPredicate = function(allPosts, post) {
			return keysRegexp.test(post.reblog_key);
		}
		return self.readLikedPostsGeneric(terminatePredicate, rejectPredicate);
	});
}

// likeは削除されたポストがあるとlimitより少ない数を返すようだ
// そのときoffsetを返ってきた個数を足すと同じポストが重複してしまう
// limitの数分足すと期待通り
//
// あとそのページのポストがすべて削除されている場合に返ってきた個数が0になることがあるから
// 返ってきた個数が0であることを終了条件にしてはいけない
Tumblr.prototype.readLikedPostsGeneric = function (terminatePredicate, rejectPredicate) {
	rejectPredicate = rejectPredicate || function () false;
	var api = this.api;
	var allPosts = [];
	const LIMIT = 20;
	var offset = 0;
	var count = 0;
	var allCount;
	function getAllCount() {
		return api.infoUser().addCallback(function(res) {
			allCount = res.user.likes;
		});
	}
	return getAllCount().addCallback(loop);
	function loop() {
		return api.likes({offset: offset, limit: LIMIT}).addCallback(function (res) {
			var posts = res.liked_posts;
			offset += LIMIT;
			count += posts.length;

			for (var i = 0; i < posts.length; i ++) {
				var post = Tumblr.wrapPost(posts[i]);
				if (terminatePredicate(allPosts, post)) {
					break;
				} else if (!rejectPredicate(allPosts, post)) {
					allPosts.push(post);
				}
			}
			if (i < posts.length || offset >= allCount) {
				return Async.succeed(allPosts);
			} else {
				return loop();
			}
		});
	}
};

// postsのAPIはlimitを大きくすれば一度に数百件とかでも返してくれる模様
Tumblr.prototype.readBlogPosts = function (baseHostname, num) {
	var posts = [];
	var api = this.api;
	const MAX = 500;
	if (num == undefined) num = Infinity;

	function loop() {
		var params = {
			offset: posts.length,
			limit: Math.min(num - posts.length, MAX)
		};
		return api.posts(baseHostname, params).addCallback(function (res) {
			res.posts.forEach(function (post) {
				if (posts.length < num) {
					posts.push(Tumblr.wrapPost(post));
				}
			});
			if (posts.length >= num || res.posts.length === 0) {
				return Async.succeed(posts);
			} else {
				return loop();
			}
		});
	}
	return loop();
};

Tumblr.prototype.reblogByPost = function(post) {
	liberator.log("reblogging "+post.post_url);
	return this.api.reblog(Config.baseHostname, {id: post.id, reblog_key: post.reblog_key});
};

Tumblr.wrapPost = function (post) {
	return new Tumblr.Post(post);
};

Tumblr.Post = function (post) {
	MochiKit.Base.update(this, post);
};

Tumblr.Post.prototype.getThumbnailURLs = function () {
	if (this.type !== "photo")
		return [];
	return this.photos.map(function (photo) {
		return photo.alt_sizes.filter(function (x) x.width === 100)[0].url;
	});
};

Tumblr.Post.prototype.getMediaURLs = function () {
	switch (this.type) {
	case "photo": return this.getPhotoURLs();
	case "video": return this.getVideoURLs();
	default:      return [];
	}
};

Tumblr.Post.prototype.getPhotoURLs = function () {
	return this.getPhotos().map(function (x) x.url);
};

Tumblr.Post.prototype.getPhotos = function () {
	if (this.type !== "photo")
		return [];
	return this.photos.map(function (photo) photo.original_size);
};

Tumblr.Post.prototype.getVideoURLs = function () {
	if (this.type !== "video")
		return [];
	var embedCode = this.player.sort(function(a, b) a.width - b.width).reverse()[0].embed_code;
	var matched = embedCode.match(/^renderVideo\("[^"]+",'([^']+)'/);
	return matched ? [matched[1]] : [];
};

