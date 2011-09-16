function TumblrAPI(accessor) {
	this.accessor = accessor;
	this.baseURL = "http://api.tumblr.com";
}

TumblrAPI.addCallbackForToJSON = function(deferred) {
	return deferred.addCallback(function (req) {
		return JSON.parse(req.responseText).response;
	});
};

// this table is from tumblife-for-ruby
// (https://github.com/mitukiii/tumblife-for-ruby/blob/master/lib/tumblife.rb)
TumblrAPI.API_SETTINGS = [
	"info         /v2/blog/%s/info             api_key",
	"avatar       /v2/blog/%s/avatar           none",
	"followers    /v2/blog/%s/followers        oauth",
	"posts        /v2/blog/%s/posts            api_key",
	"queue        /v2/blog/%s/posts/queue      oauth",
	"draft        /v2/blog/%s/posts/draft      oauth",
	"submission   /v2/blog/%s/posts/submission oauth",
	"createPost   /v2/blog/%s/post             oauth   post",
	"editPost     /v2/blog/%s/post/edit        oauth   post",
	"reblogPost   /v2/blog/%s/post/reblog      oauth   post",
	"deletePost   /v2/blog/%s/post/delete      oauth   post",
	"dashboard    /v2/user/dashboard           oauth",
	"likes        /v2/user/likes               oauth",
	"following    /v2/user/following           oauth",
	"follow       /v2/user/follow              oauth   post",
	"unfollow     /v2/user/unfollow            oauth   post",
	"infoUser     /v2/user/info                oauth",
];

TumblrAPI.API_SETTINGS.forEach(function (setting) {
	var [methodName, path, auth, httpMethod] = setting.split(/\s+/);
	httpMethod = httpMethod || "get";
	var requiredBaseHostname = /%s/.test(path);

	TumblrAPI.prototype[methodName] = function() {
		var params, url;
		if (requiredBaseHostname) {
			var baseHostname = arguments[0];
			params = arguments[1];
			url = this.baseURL + path.replace("%s", baseHostname);
		} else {
			params = arguments[0];
			url = this.baseURL + path;
		}
		if (auth === "api_key") {
			params = MochiKit.Base.merge(params, {api_key: this.accessor.consumerKey});
		}
		return this[httpMethod](url, params);
	};
});

TumblrAPI.prototype.get = function(url, parameters) {
	return TumblrAPI.addCallbackForToJSON(this.request("GET", url, parameters));
};

TumblrAPI.prototype.post = function(url, parameters) {
	return TumblrAPI.addCallbackForToJSON(this.request("POST", url, parameters));
};

TumblrAPI.prototype.request = function(method, url, parameters) {
	liberator.log("TumblrAPI#request "+uneval([method, url, parameters]));
	var message = {method: method,
	               action: url,
	               parameters: parameters};
	var requestBody = null;
	var newUrl = url;
	if (method === "POST") {
		requestBody = OAuth.formEncode(parameters);
	} else {
		newUrl = OAuth.addToURL(url, parameters);
	}
	OAuth.completeRequest(message, this.accessor);
	var req = new XMLHttpRequest();
	req.open(method, newUrl, true);
	var realm = "";
	var authorization = OAuth.getAuthorizationHeader(realm, message.parameters);
	req.setRequestHeader("Authorization", authorization);
	if (method == "POST") {
		req.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
	}
	return Async.sendXMLHttpRequest(req, requestBody);
};

