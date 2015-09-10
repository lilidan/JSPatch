var global = this

;(function() {

  var callbacks = {}
  var callbackID = 0
  
  var _methodNameOCToJS = function(name) {
    name = name.replace(/\:/g, '_')
    if (name[name.length - 1] == '_') {
      return name.substr(0, name.length - 1)
    }
    return name
  }

  var _formatOCToJS = function(obj) {
    if (obj === undefined || obj === null) return false
    if (typeof obj == "object") {
      if (obj.__obj) return obj
      if (obj.__isNil) return false
    }
    if (obj instanceof Array) {
      var ret = []
      obj.forEach(function(o) {
        ret.push(_formatOCToJS(o))
      })
      return ret
    }
    if (obj instanceof Function) {
        return function() {
            var args = Array.prototype.slice.call(arguments)
            var formatedArgs = _OC_formatJSToOC(args)
            for (var i = 0; i < args.length; i++) {
                if (args[i] === null || args[i] === undefined || args[i] === false) {
                formatedArgs.splice(i, 1, undefined)
            } else if (args[i] == nsnull) {
                formatedArgs.splice(i, 1, null)
            }
        }
        return _OC_formatOCToJS(obj.apply(obj, formatedArgs))
      }
    }
    if (obj instanceof Object) {
      var ret = {}
      for (var key in obj) {
        ret[key] = _formatOCToJS(obj[key])
      }
      return ret
    }
    return obj
  }
  
  var _methodFunc = function(instance, clsName, methodName, args, isSuper, isPerformSelector) {
    var selectorName = methodName
    if (!isPerformSelector) {
      methodName = methodName.replace(/__/g, "-")
      selectorName = methodName.replace(/_/g, ":").replace(/-/g, "_")
      var marchArr = selectorName.match(/:/g)
      var numOfArgs = marchArr ? marchArr.length : 0
      if (args.length > numOfArgs) {
        selectorName += ":"
      }
    }
    var ret = instance ? _OC_callI(instance, selectorName, args, isSuper):
                         _OC_callC(clsName, selectorName, args)
    return _formatOCToJS(ret)
  }

  //调用一个不存在方法时，能转发到一个指定函数去执行，就能解决一切问题了，这其实可以用简单的字符串替换，把JS脚本里的方法调用都替换掉。最后的解决方案是，在OC执行JS脚本前，通过正则把所有方法调用都改成调用 __c() 函数，再执行这个JS脚本，做到了类似OC/Lua/Ruby等的消息转发机制：
    Object.defineProperty(Object.prototype, "__c", {value: function(methodName) {
    if (this instanceof Boolean) {
      return function() {
        return false
      }
    }
    
    if (!this.__obj && !this.__clsName) {
       //如果没有obj和类名，则bind方法名到this
      return this[methodName].bind(this);
    }

    var self = this
    if (methodName == 'super') {
      return function() {
        //如果是获取父类，则返回一个返回xx的闭包
        return {__obj: self.__obj, __clsName: self.__clsName, __isSuper: 1}
      }
    }

    if (methodName == 'performSelector') {
      return function(){
        //如果是selector  则返回第一个参数为名字的方法
        var args = Array.prototype.slice.call(arguments)
        return _methodFunc(self.__obj, self.__clsName, args[0], args.splice(1), self.__isSuper, true)
        //就是把相关信息传给OC，OC用 Runtime 接口调用相应方法，返回结果值，这个调用就结束了。
      }
    }
    return function(){
      var args = Array.prototype.slice.call(arguments)
      return _methodFunc(self.__obj, self.__clsName, methodName, args, self.__isSuper)
    }
  }, configurable:false, enumerable: false})

  
  //调用 require(‘UIView’) 后，就可以直接使用 UIView 这个变量去调用相应的类方法了，require 做的事很简单，就是在JS全局作用域上创建一个同名变量，变量指向一个对象，对象属性__isCls表明这是一个 Class，__clsName保存类名，在调用方法时会用到这两个属性。
  //所以调用require(‘UIView’)后，就在全局作用域生成了 UIView 这个变量，指向一个这样一个对象：
  var _require = function(clsName) {
    if (!global[clsName]) {
      global[clsName] = {
        __isCls: 1,
        __clsName: clsName
      }
    } 
    return global[clsName]
  }

  
  global.require = function(clsNames) {
    var lastRequire
    clsNames.split(',').forEach(function(clsName) {
      lastRequire = _require(clsName.trim())
    })
    return lastRequire
  }

  var _formatDefineMethods = function(methods, newMethods) {
    for (var methodName in methods) {
      (function(){
       var originMethod = methods[methodName]
        newMethods[methodName] = [originMethod.length, function() {
          var args = _formatOCToJS(Array.prototype.slice.call(arguments))
          var lastSelf = global.self
          
          global.self = args[0]
          args.splice(0,1)
          var ret = originMethod.apply(originMethod, args)
          global.self = lastSelf
          
          return ret
        }]
      })()
    }
  }

  global.defineClass = function(declaration, instMethods, clsMethods) {
    var newInstMethods = {}, newClsMethods = {}
    _formatDefineMethods(instMethods, newInstMethods)
    _formatDefineMethods(clsMethods, newClsMethods)

    var ret = _OC_defineClass(declaration, newInstMethods, newClsMethods)

    return require(ret["cls"])
  }

  global.block = function(args, cb) {
    var slf = this
    if (args instanceof Function) {
      cb = args
      args = ''
    }
    var callback = function() {
      var args = Array.prototype.slice.call(arguments)
      return cb.apply(slf, _formatOCToJS(args))
    }
    return {args: args, cb: callback}
  }

  global.defineStruct = function(name, type, keys) {
    require('JPEngine').defineStruct({
      'name': name,
      'types': type,
      'keys': keys
    })
  }
  
  if (global.console) {
    var jsLogger = console.log;
    global.console.log = function() {
      global._OC_log.apply(global, arguments);
      if (jsLogger) {
        jsLogger.apply(global.console, arguments);
      }
    }
  } else {
    global.console = {
      log: global._OC_log
    }
  }
  
  global.YES = 1
  global.NO = 0
  global.nsnull = _OC_null
  global._formatOCToJS = _formatOCToJS
  
})()