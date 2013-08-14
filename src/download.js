!function () {
  // You'll need an application registered at http://www.tumblr.com/oauth/apps
  // Just put the OAuth Consumer Key here (Tumblr's version of application-auth
  // is really simple and unsigned.)
  const key = "";
  // Next, put your Tumblr domain name here. That might be 'benw.tumblr.com' or
  // 'blog.benward.me'.
  const domain = "example.tumblr.com";

  // Since we're pasting this on gist rather than giving you a full repo to
  // check out, you should 'npm install request' before running.
  var req = require('request');
  var url = require('url');
  var fs  = require('fs');

  function queryString (q) {
    return Object.keys(q).map(function (k) { return k + '=' + q[k]; }).join('&');
  }

  function write (post) {
    fs.writeFile('posts/' + post.id + '.json', JSON.stringify(post), function () {
      console.log("Wrote " + post.url);
    });
  }

  function getPosts (then, start) {
    start = start || 0;
    if (!then) return;
    var u = url.format({
      protocol: 'http:',
      hostname: 'api.tumblr.com',
      search: queryString({
        api_key: key,
        offset: start,
        limit: 20,
        filter: 'raw'
      }),
      pathname: '/v2/blog/' + domain + '/posts'
    });

    req.get(u, function (err, response, body) {
      if (err) return console.log(err);
      var rsp = JSON.parse(body).response;
      start += rsp.posts.length;
      then(rsp);
      if (start < rsp.blog.posts) {
        getPosts(then, start);
      }
    });
  }

  if (!fs.existsSync('posts')) fs.mkdirSync('posts');
  getPosts(function (rsp) {
    rsp.posts.forEach(write);
  });
}();