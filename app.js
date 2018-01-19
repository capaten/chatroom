var express = require('express');
var path = require('path');
var hbs = require('hbs');
var app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);     //将socket的监听加到app设置的模块里。
const ChatModel = require('./module/chat');

const users = [];                    //用来保存所有的用户信息
let usersNum = 0;
const _sockets = [];                 //将socket和用户名匹配
let IP = null;

var index = require('./routes/index');
// var users = require('./routes/users');


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

app.engine('hbs',hbs.__express);
hbs.registerPartials(__dirname + '/views');
hbs.registerPartials(__dirname + '/views/partials');

app.use(express.static(path.join(__dirname, 'public')));

app.use('/', index);
// app.use('/users', users);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});
server.listen(3000,function(){
	console.log('服务已启动,正在监听3000端口');
});

/**
 * 获取用户IP的函数
 */
app.use((req, res) => {
  IP = (req.headers['x-forwarded-for'] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      req.connection.socket.remoteAddress).toString();
});


/*socket*/
io.on('connection',(socket)=>{              //监听客户端的连接事件
  /**
   * 所有有关socket事件的逻辑都在这里写
   */
  usersNum ++;
  console.log(`当前有${usersNum}个用户连接上服务器了`);
  socket.on('login',(data)=>{
      /**
       * 先保存在socket中
       * 循环数组判断用户名是否重复,如果重复，则触发usernameErr事件
       * 将用户名删除，之后的事件要判断用户名是否存在
       */
      socket.username = data.username;
      for (let user of users) {
          if(user.username === data.username){
              socket.emit('usernameErr',{err: '用户名重复'});
              socket.username = null;
              break;
          }
      }
      //如果用户名存在。将该用户的信息存进数组中
      if(socket.username){
          users.push({
              username: data.username,
              message: [],
              dataUrl: [],
              touXiangUrl: data.touXiangUrl
          });

          //保存socket
          _sockets[socket.username] = socket;
          //然后触发loginSuccess事件告诉浏览器登陆成功了,广播形式触发
          data.userGroup = users;         //将所有用户数组传过去
          io.emit('loginSuccess',data);   //将data原封不动的再发给该浏览器
          /**
           * 保存到数据库
           * @type {{username: (*), socketID, IP: *, message: Array, ImgURL: Array, connectTime: number}}
           */
          let obj = {
              tmpID: socket.username.toString(),
              socketID: socket.id.toString(),
              IP: IP,
              message: [],
              ImgURL: [],
              connectTime: Date.now()
          };
          ChatModel.create(obj);
      }

  });

  /**
   * 监听sendMessage,我们得到客户端传过来的data里的message，并存起来。
   * 我使用了ES6的for-of循环，和ES5 的for-in类似。
   * for-in是得到每一个key，for-of 是得到每一个value
   */
  socket.on('sendMessage',(data)=>{
      for(let _user of users) {
          if(_user.username === data.username) {
              _user.message.push(data.message);
              //信息存储之后触发receiveMessage将信息发给所有浏览器
              io.emit('receiveMessage',data);
              /**
               * 持久化该消息
               */
              ChatModel.updateByTmpID({tmpID: socket.username}, {$push: {message: {msg: data.message}}}, {}, (err, data) => {
                  if(err) {
                      console.log(err.message);
                  }
                  console.log(data);
              });
              break;
          }
      }
  });

  /**
   * 仿照sendMessage监听sendImg事件
   */
  socket.on("sendImg",(data)=>{
      for(let _user of users) {
          if(_user.username === data.username) {
              _user.dataUrl.push(data.dataUrl);
              //存储后将图片广播给所有浏览器
              io.emit("receiveImg",data);
              /**
               * 持久化该图片
               */
              ChatModel.updateByTmpID({tmpID: socket.username}, {$push: {ImgURL: {data: data.dataUrl}}}, {}, (err, data) => {
                  if(err) {
                      console.log(err.message);
                  }
                  console.log(data);
              });
              break;
          }
      }
  });

  socket.on('sendToOne',(data)=>{
      //判断该用户是否存在，如果存在就触发receiveToOne事件
      for (let _user of users) {
          if (_user.username === data.to) {
              _sockets[data.to].emit('receiveToOne',data);
              /**
               * 持久化私聊消息
               */
              ChatModel.updateByTmpID({tmpID: socket.username}, {$push: {message: {msg: data.text, to: data.to}}}, {}, (err, data) => {
                  if(err) {
                      console.log(err.message);
                  }
                  console.log(data);
              })
          }
      }
  });

  //断开连接后做的事情
  socket.on('disconnect',()=>{          //注意，该事件不需要自定义触发器，系统会自动调用
      usersNum --;
      console.log(`当前有${usersNum}个用户连接上服务器了`);

      //触发用户离开的监听
      socket.broadcast.emit("oneLeave",{username: socket.username});

      //删除用户
      users.forEach(function (user,index) {
          if(user.username === socket.username) {
              users.splice(index,1);       //找到该用户，删除
          }
      })
  })
});

module.exports = app;
