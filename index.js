function createDoubleBufferWithCursor (execlib) {
  'use strict';

  var lib = execlib.lib;


  function BufferWithCursor(param) {
    this.buffer = new Buffer(param);
    this.cursor = 0;
    this.anchor = 0;
  }
  BufferWithCursor.prototype.destroy = function () {
    this.anchor = 0;
    this.cursor = null;
    this.buffer = null;
  };
  BufferWithCursor.prototype.isProcessed = function () {
    return this.cursor >= this.buffer.length;
  };
  BufferWithCursor.prototype.tick = function (howmany) {
    this.cursor += howmany;
  };
  BufferWithCursor.prototype.chunk = function () {
    return this.buffer.slice(this.anchor, this.cursor);
  };
  BufferWithCursor.prototype.chunkLength = function () {
    if (this.cursor < this.anchor) {
      throw new lib.Error('INVALID_CURSOR_VS_ANCHOR_POSITION', this.cursor+' cannot be less than '+this.anchor);
    }
    return this.cursor - this.anchor;
  };
  BufferWithCursor.prototype.tail = function () {
    return this.buffer.slice(this.anchor);
  };
  BufferWithCursor.prototype.resetAnchor = function () {
    this.anchor = this.cursor;
  };
  BufferWithCursor.prototype.remaining = function () {
    return this.buffer.length - this.anchor;
  };
  BufferWithCursor.prototype.unprocessed = function () {
    return this.buffer.length - this.cursor;
  };
  BufferWithCursor.prototype.valueAtCursor = function (offset) {
    return this.buffer[this.cursor + (this.offset||0)];
  };
  BufferWithCursor.prototype.appendFrom = function (other, howmany) {
    other.buffer.copy(this.buffer,this.cursor,other.cursor,other.cursor+howmany); 
  };
  BufferWithCursor.prototype.appendTo = function (other, howmany) {
    if ('undefined' === typeof howmany) {
      howmany = this.chunkLength();
    }
    this.buffer.copy(other.buffer,other.cursor,this.anchor,this.anchor+howmany);
    other.cursor+=howmany;
  };
  BufferWithCursor.prototype.toString = function () {
    return this.buffer.slice(this.cursor).toString();
  };

  function DoubleBufferWithCursor(parser){
    this.parser = parser;
    this.current = null;
    this.previous = null;
    this.pending = null;
  }
  DoubleBufferWithCursor.prototype.destroy = function () {
    this.pending = null;
    if (this.previous) {
      this.previous.destroy();
    }
    this.previous = null;
    if (this.current) {
      this.current.destroy();
    }
    this.current = null;
    this.parser = null;
  };
  DoubleBufferWithCursor.prototype.purgePrevious = function () {
    if (!this.previous) {
      throw new lib.Error('CANNOT_PURGE_PREVIOUS', 'Previous buffer cannot be purged because it does not exist');
    }
    this.previous.destroy();
    this.previous = null;
  };
  DoubleBufferWithCursor.prototype.process = function (buffer) {
    var ret = [];
    if (this.previous) {
      if (this.previous.unprocessed() < 1) {
        this.purgePrevious();
      } else {
        throw new lib.Error('CANNOT_SET_BUFFER_PREVIOUS_STILL_EXISTS');
      }
    }
    this.previous = this.current;
    this.current = new BufferWithCursor(buffer);
    while (this.current.unprocessed()) {
      switch (this.atDelimiter()) {
        case null:
          return ret;
        case true:
          this.processChunk(ret, this.chunk());
      }
    }
    //cb(this.chunk());
    return ret;
  };
  DoubleBufferWithCursor.prototype.processChunk = function (ret, completechunk) {
    var rec;
    if (completechunk) {
      if (this.parser.isNewRecord(completechunk)) {
        rec = this.pending;
        this.pending = this.parser.createBuffer(completechunk);
      } else {
        this.parser.augmentBuffer(this.pending, completechunk);
      }
      if (rec) {
        rec = this.parser.postProcessFileToData(rec);
        if (lib.isVal(rec)) {
          ret.push(rec);
        }
      }
    }
  };
  DoubleBufferWithCursor.prototype.finalize = function () {
    var pending = this.pending;
    this.pending = null;
    if (pending) {
      return this.parser.postProcessFileToData(pending);
    }
  };
  DoubleBufferWithCursor.prototype.atDelimiter = function () {
    var p = this.previous,
      c = this.current,
      rd = this.parser.recordDelimiter,
      dl = rd.length,
      i = 0,
      logobj = {dolog: false},
      w,
      cunp = c.unprocessed();
    if (dl > cunp) {
      if (cunp) {
        //console.log('that is it,',dl,'>',cunp, 'with tail', c.tail());
        //console.log('finished with buffer,',c.chunkLength(),'bytes left');
        return null;
      } else {
        return true;
      }
    }
    w = (p && p.unprocessed()) ? p : c;
    while (i < dl) {
      if (this.matchesDelimiter(rd, i, w, logobj)) {
        w = (p && p.unprocessed()) ? p : c;
      } else {
        return false;
      }
      i++;
    }
    return true;
  };
  DoubleBufferWithCursor.prototype.matchesDelimiter = function (delimiter, i, buffer, logobj) {
    if (delimiter[i] !== buffer.valueAtCursor()) {
      if (logobj.dolog) {
        //console.log(delimiter[i], '<>', buffer.valueAtCursor(), 'working at', buffer.cursor);
      }
      buffer.tick(i ? 1-i : 1); //tricky part - reset cursor to retry matching
      return false;
    }
    logobj.dolog = true;
    //console.log(delimiter[i], '==', buffer.valueAtCursor(), 'working at', buffer.cursor);
    buffer.tick(1);
    return true;
  };
  DoubleBufferWithCursor.prototype.chunk = function () {
    var pr = this.previous ? this.previous.remaining() : 0, l, c, ret;
    if (pr) {
      l = pr + this.current.chunkLength();
      c = new BufferWithCursor(l);
      this.previous.appendTo(c);
      //console.log('current',this.current,'will append to chunk',c.buffer);
      this.current.appendTo(c);
      //console.log('after appending, chunk',c.buffer);
      this.previous.destroy();
      this.previous = null;
      ret = c.buffer;
      c.destroy();
      this.current.resetAnchor();
      return ret;
    } else {
      ret = this.current.chunk();
      this.current.resetAnchor();
      return ret;
    }
  };

  return DoubleBufferWithCursor;
}

module.exports = createDoubleBufferWithCursor;
