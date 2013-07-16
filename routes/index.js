var config = require("../config");
var GHAPI = require("../gh-api").GHAPI;
var sys = require('util');
var User = require('../models/User').User;
var BlogPost = require('../models/BlogPost').BlogPost;
var GitHubApi = require('github');
var qs = require('querystring');
var MD = require('marked');

var github = new GitHubApi({
  version: "3.0.0"
});

function getClientIp(req) {

  var ipAddress;
  // Amazon EC2 / Heroku workaround to get real client IP
  var forwardedIpsStr = req.header('x-forwarded-for');
  if (forwardedIpsStr) {

    // 'x-forwarded-for' header may return multiple IP addresses in
    // the format: "client IP, proxy 1 IP, proxy 2 IP" so take the
    // the first one
    var forwardedIps = forwardedIpsStr.split(',');
    ipAddress = forwardedIps[0];
  }
  if (!ipAddress) {
    // Ensure getting client IP address still works in
    // development environment
    ipAddress = req.connection.remoteAddress;
  }
  return ipAddress;
};

var render = function(res, path, opts) {
  opts = opts || {};
  opts.sitename = opts.sitename || config.sitename;
  opts.title = opts.title || config.title;
  opts.ga_id = opts.ga_id || config.ga_id;
  opts.ga_domain = opts.ga_domain || config.ga_domain;

  res.render(path, opts);
};

var get_user = function(req, callback) {
  var gh_userid = req.session.user.userid;
  User.findOne({gh_userid: gh_userid}, function(err, doc) {
    if (err) {
      console.log("ERROR get_user: " + err);
      callback(err, doc);
      return;
    }
    if (doc) {
      callback(err, doc);
    } else {
      callback("no user!", doc);
    }
  });
};

exports.index = function(req, res) {
  BlogPost.find({isPublic: true}).sort('tstamp', -1).exec(generic_doc_handler(res, function(docs) {
    render(res, 'index', {title: "Home", blog_posts: docs, user: req.session.user});
  }));
};

exports.about = function(req, res) {
  render(res, "about", {title: "About", user: req.session.user});
};

exports.bounce_shortid = function(req, res) {
  BlogPost.findOne({shortid: req.params.id}, generic_doc_handler(res, function(doc) {
    res.redirect('/' + doc.gistIdStr);
  }));
};

exports.view_post = function(req, res) {

  BlogPost.findOne({gistIdStr: req.params.id}, function(e, doc) {
    if (e) {
      res.end('fatal error :(');
      return;
    }
    if (!doc) {
      doc = {};
    }
    var access_token = (req.session && req.session.user ? req.session.user.access_token : config.gh_application_access_token);
    var ghapi = new GHAPI(access_token);
    //ghapi.getStatus(req.params.id, function(err, result, obj) {
    ghapi.request(ghapi.client.gists.get, {id: req.params.id}, function(err, gist) {
      if (err) {
        console.log('view_post error w/ api: ' + err);
        res.end('error....');
        return;
      }
      console.log("GIST!!!!!\n" + JSON.stringify(gist, null, 4));
      //res.end(JSON.stringify(gist, null, 4));



      if (gist.user && gist.url) {
        var metadata = JSON.parse(gist.files["metadata.json"].content);
        var viewable = false;

        if (gist["public"]) {
          viewable = true;
        } else {
          // private...
          if (req.session && req.session.user && gist.user.id.toString() === req.session.user.userid) {
            // owner, so yes
            viewable = true;
          } else {
            // see if user is in allowed_viewers
            if (req.session && req.session.user && req.session.user.username) {
              var allowed_viewers = metadata.allowed_viewers || {};
              for (var idx = 0; idx < allowed_viewers.length; idx++) {
                if (allowed_viewers[idx] === req.session.user.username) {
                  viewable = true;
                  break;
                }
              }
            }
          }
        }

        if (viewable) {
          var post = gist.files["post.md"].content;
          var title = metadata.title;
          MD(post, {gfm: true}, function(err, content) {
            doc.body = content;
            doc.title = title;
            doc.username = gist.user.login;
            doc.post_id = gist.id;
            doc.tstamp = new Date(gist.created_at);

            render(res, 'view_post', {user: req.session.user, blog_post: doc, title: doc.title});

            update_post(req, res, doc);
          });
        } else {

          render(res, 'not_found', {title: "Not Found", user: req.session.user});
        }
      } else {

        BlogPost.findOne({gistIdStr: req.params.id}).remove();

        //res.end('invalid post id');
        render(res, 'not_found', {title: "Not Found", user: req.session.user});


      }
    });
  });

};

exports.user_index = function(req, res) {
  User.findOne({username: req.params.username}, generic_doc_handler(res, function(doc) {
    BlogPost.find({ownerIdStr: doc.gh_userid, isPublic: true}).sort('tstamp', -1).exec(generic_doc_handler(res, function(docs) {
      render(res, 'user_index', {title: doc.username, blog_posts: docs, user: req.session.user, author: doc});
    }));
  }));
};

exports.ajax_human_view = function(req, res) {
  BlogPost.findOne({gistIdStr: req.params.id}, generic_doc_handler(res, function(blog_post) {
    blog_post.views++;
    update_post(req, res, blog_post);
    res.end('ok');
  }));
};

var generic_doc_handler = function(res, callback) {
  return function(err, doc) {
    if (err) {
      res.end('fatal error');
      return;
    }

    if (doc) {
      callback(doc);
    } else {
      res.end('no such item');

    }
  };
};

exports.new_post = function(req, res) {
  render(res, 'new_post', {user: req.session.user, blog_post: null, title: "New Post"});
};

exports.create_post = function(req, res) {
  publish_post(req, res, true, null);
};

var publish_post = function(req, res, is_newpost, blog_post) {
  get_user(req, function(err, user) {
    if (err) {
      res.end('error!');
      return;
    }
    if (user) {
      if (is_newpost) {
        blog_post = new BlogPost();
      }


      blog_post.title = req.body.title.trim();
      blog_post.ownerIdStr = user.gh_userid;
      blog_post.ownerUsername = user.username;
      blog_post.save(function(e, d) {
        if (e) {
          console.log('error saving 1st time: ' + e);
          return;
        }
        console.log('new post shortid: ' + d.shortid);

        var ghapi = new GHAPI(user.gh_access_token);
        var entities;
        if (process.env.NODE_ENV === "production") {

        }
        var func = is_newpost ? ghapi.client.gists.create : ghapi.client.gists.edit;
                       console.log("IS_PRIVATE IS " + req.body.is_private);
        var is_private = req.body.is_private == "on" ? true : false;
        var visibility = is_private ? "private" : "public";
        var metadata = {
          title: req.body.title.trim(),
          visbility: visibility
        };
        if (req.body.allowed_viewers && req.body.allowed_viewers.length && is_private) {
          metadata.allowed_viewers = req.body.allowed_viewers.split(",").map(function(item){return item.trim();});
        }
        var opts = {
          "public": !is_private,
          files: {
            "post.md": {
              content: req.body.body.trim()
            },
            "metadata.json" : {
              content: JSON.stringify(metadata, null, 4)
            }
          }
        };
        if (!is_newpost) {
          opts.id = blog_post.gistIdStr;
        }
        ghapi.request(func, opts, function(err2, gist) {
          if (err2) {
            console.log('error posting gist: ' + err2);
            return;
          }
          console.log("GIST!!!!!");
          console.log(sys.inspect(gist));
          console.log("<<<< GIST!!!!!!");
          if (!gist.url) {
            res.end('something went terribly wrong :(');
            return;
          }
          d.gistIdStr = gist.id.toString();
          d.visibility = visibility;
          d.isPublic = !is_private;
          d.save(function(ee, dd) {
            if (ee) {
              console.log('error saving 2nd time: ' + ee);
              return;
            }
            res.redirect('/gist/'+ dd.gistIdStr);
          });
        });
      });


    } else {

      res.end('no user!');
      return;
    }
  });
};

var update_post = function(req, res, blog_post, callback) {
  if (blog_post && blog_post.save) {
    blog_post.save(function(err, doc) {
      if (callback) {
        callback();
      }
    });
  }
};

exports.login = function(req, res) {
  res.redirect("https://github.com/login/oauth/authorize?client_id=" + config.gh_consumer_key + "&response_type=token&redirect_uri=" + config.gh_callback + "&scope=gist");
};

exports.logout = function(req, res) {
  req.session.destroy(function(err) {
    if (err) {
      console.log("error logging out: " + err);
    }
    res.redirect("/");
  });
};

exports.oauth_return = function(req, res) {
  console.log("code is: " + req.query.code);
  var ghapi = new GHAPI();
  ghapi.getAccessToken(req.query.code, function(err, result, data) {
    console.log(data);
    console.log("got access token: " + data.access_token);
    if (data.error) {
      res.end('error: ' + data.error);
      return;
    }
    //github.authenticate({type: "oauth", "token": data.access_token});
    //console.log('kicking off get.user');
    //github.user.get({}, function(err, user) {
    ghapi.access_token = data.access_token;
    ghapi.request(ghapi.client.user.get, {}, function(err, user) {
      console.log("got user result: " + JSON.stringify(user));
      req.session.user = {
        "userid": user.id.toString(),
        "username": user.login,
        "avatar": user.avatar_url,
        "access_token": data.access_token,
        "is_admin": user.id.toString() === config.admin_userid ? true : false,
        "name": user.name
      };
                    console.log('user.id: ' + user.id.toString());
                    console.log('config.admin: ' + config.admin_userid);

      User.findOne({gh_userid: user.id}, function(err, doc) {
        if (err) {
          console.log("ERROR: " + err);
          res.end('error');
          return;
        }
        if (!doc) {
          doc = new User();
        }
        doc.username = user.login;
        doc.gh_userid = user.id.toString();
        doc.name = user.name;
        doc.gh_access_token = data.access_token;
        doc.avatar = user.avatar_url;
        doc.is_admin = user.id.toString() === config.admin_userid ? true : false;
        doc.save(function(e,d){});

        res.redirect('/');
      });
    });
  });
};
