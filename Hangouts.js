let _ = require('underscore');
let escape = require('xml-escape');

_.mixin({
  "whereNot": function(obj, attrs) {
    return _.filter(obj, _.negate(_.matches(attrs)));
  }
});

function Message(event, conversation) {
  this.conversation_id = event['conversation_id']['id'];
  this.conversation = conversation;
  this.sender_id = event['sender_id']['chat_id'];
  //Timestamp is in microseconds
  this.timestamp = new Date(event['timestamp'] / 1000);
  this.event_id = event['event_id'];
  this.event_type = event['event_type'];
  
  var text = undefined;
  var attachments = [];
  
  if(event['chat_message']) {
    var message_content = event['chat_message']['message_content'];
    if(message_content['segment']) {
      text = "";
      message_content['segment'].forEach(function(segment) {
        if(segment.type === "TEXT") {
          text += segment.text;
        }
        else if(segment.type === "LINE_BREAK") {
          text += "\n";
        }
        else if(segment.type === "LINK") {
          text += segment['link_data']['link_target'];
        }
        else {
          console.log("Unknown segment type " + segment.type);
        }
      });
    }
    
    if(message_content['attachment']) {
      message_content['attachment'].forEach(function(attachment) {
        var item = attachment['embed_item'];
        if(item['type'][0] === "PLUS_PHOTO") {
          attachments.push({
            type: "image",
            url:  item['plus_photo']['url']
          });
        }
      });
    }
  }
  
  this.text = text;
  this.attachments = attachments;
}

Message.prototype.toJSON = function() {
  //prevent circular object error
  return _.omit(this, ['conversation', 'self_user_id']);
};

Message.prototype.toXml = function() {
  let sms = {
    _attributes: {
      protocol:       0,
      address:        this.conversation.getAddress(), //Please replace with 'conversation.getNumber'
      date:           this.timestamp.getTime(),
      type:           this.sender_id === this.conversation.hangouts.self_user_id ? 2 : 1, //1 if receiver; 2 if sender
      subject:        null,
      body:           escape(this.text),
      toa:            null,
      sc_toa:         null,
      service_center: null,
      read:           1,
      status:         -1,
      locked:         0,
      date_sent:      0,
      readable_date:  escape(this.timestamp.toDateString()),
      contact_name:   this.conversation.getName() //Please replace with 'conversation.getName'
    }
  };
  
  var mms = {
    _attributes: {
      text_only:     this.attachments.length == 0 ? 1 : 0,
      ct_t:          "application/vnd.wap.multipart.related",
      msg_box:       this.sender_id === this.conversation.hangouts.self_user_id ? 2 : 1,
      sub:           null,
      v:             18, //mms version
      seen:          0,
      rr:            129, //Read report
      ct_cls:        null,
      retr_txt_cs:   null,
      ct_l:          null,
      m_size:        null,
      exp:           null,
      sub_cs:        null,
      st:            null,
      creator:       "com.nvonbulow.HangoutsConverter",
      tr_id:         null,
      sub_id:        -1, //subscription id
      read:          1,
      date:          this.timestamp.getTime(),
      resp_st:       null,
      m_id:          null, //message id... Need to generate a unique number for this...
      date_sent:     this.timestamp.getTime(),
      pri:           129, //priority
      m_type:        this.sender_id == this.conversation.hangouts.self_user_id ? 128 : 132, //message type as defined by the mms spec!
      address:       this.conversation.getAddress(),
      d_rpt:         129, //delivery report
      d_tm:          null,
      read_status:   null,
      m_cls:         "personal",
      retr_st:       null,
      readable_date: escape(this.timestamp.toDateString()),
      contact_name:  this.conversation.getName()
    },
    parts:       {
      part: []
    },
    addrs:       {
      addr: []
    }
  };
  
  var partNumber = 0;
  this.attachments.forEach((function(attachment) {
    mms.parts.part.push({
      _attributes: {
        seq:   partNumber,
        ct:    "text/plain",
        name:  "part-" + partNumber,
        chset: 106,
        cd:    null,
        fn:    "part-" + partNumber,
        cid:   null,
        cl:    null,
        ctt_s: null,
        ctt_t: null,
        text:  escape(attachment.url)
      }
    });
    partNumber++;
  }).bind(this));
  
  if(this.text) {
    mms.parts.part.push({
      _attributes: {
        seq:   partNumber,
        ct:    "text/plain",
        name:  "part-" + partNumber,
        chset: 106,
        cd:    null,
        fn:    "part-" + partNumber,
        cid:   null,
        cl:    null,
        ctt_s: null,
        ctt_t: null,
        text:  escape(this.text)
      }
    });
  }
  
  this.conversation.participants.forEach((function(participant) {
    var selfSend = false;
    if(this.conversation.hangouts.self_user_id === participant.id) {
      if(this.sender_id === participant.id) {
        selfSend = true;
      }
      else {
        return;
      }
    }
    mms.addrs.addr.push({
      _attributes: {
        address: selfSend ? 'insert-address-token' : participant.phone_number,
        type:    this.sender_id == participant.id ? 137 : 151,
        charset: 106
      }
    });
  }).bind(this));
  
  if(this.conversation.participants.length === 2 && this.attachments.length === 0) {
    return {
      sms: sms,
      mms: null
    };
  }
  else {
    return {
      sms: null,
      mms: mms
    };
    
  }
};

function Conversation(conversation_state, list) {
  let data = conversation_state['conversation'];
  let conversation = conversation_state['conversation']['conversation'];
  this.hangouts = list;
  this.id = data['conversation_id']['id'];
  this.participants = conversation['participant_data'].map(function(participant_data) {
    var participant = {
      id:   participant_data['id']['chat_id'],
      name: participant_data['fallback_name']
    };
    if(participant.id === list.self_user_id) {
      return null;
    }
    if(participant_data['phone_number']) {
      participant['phone_number'] = participant_data['phone_number']['e164'];
    }
    return participant;
  });
  var messages = [];
  let thisConvo = this;
  conversation_state['events'].forEach(function(event) {
    var message = new Message(event, thisConvo);
    if(message) {
      messages.push(message);
    }
  });
  this.messages = messages;
}

Conversation.prototype.toJSON = function() {
  //prevent circular object
  return _.omit(this, ['hangouts', 'self_user_id']);
};

Conversation.prototype.toXml= function() {
  var smses = [];
  var mmses = [];
  this.messages.forEach((function(message) {
    var xmlMessage = message.toXml();
    if(xmlMessage.sms) {
      smses.push(xmlMessage.sms);
    }
    else {
      mmses.push(xmlMessage.mms);
    }
  }).bind(this));
  return {
    sms: smses,
    mms: mmses
  };
};

Conversation.prototype.findParticipant = function(userId) {
  return _.findWhere(this.participants, {id: userId});
};

Conversation.prototype.otherParticipants = function(userId) {
  if(!userId) {
    userId = this.hangouts.self_user_id;
  }
  return _.whereNot(this.participants, {id: userId});
};

Conversation.prototype.getAddress = function() {
  var others = this.otherParticipants();
  var address = "";
  for(let participant in others) {
    if(others[participant].id === this.hangouts.self_user_id) {
      continue;
    }
    address += others[participant].phone_number + "~";
  }
  return address.slice(0, -1);
};

Conversation.prototype.getName = function() {
  var others = this.otherParticipants();
  var name = "";
  for(let participant in others) {
    if(others[participant].id === this.hangouts.self_user_id) {
      continue;
    }
    name += others[participant].name + ", ";
  }
  return name.slice(0, -2);
};

function Hangouts(data) {
  var conversations = [];
  var thisList = this;
  data['conversations'].forEach(function(conversation) {
    conversations.push(new Conversation(conversation, thisList));
  });
  this.conversations = conversations;
  function getUserId() {
    //Find most common id in all participant ids because the user's id should show up in every conversation.
    var idList = [];
    conversations.forEach(function(conversation) {
      conversation.participants.forEach(function(participant) {
        idList.push(participant.id);
      });
    });
    return idList.sort((a, b) => idList.filter(v => v === a).length - idList.filter(v => v === b).length).pop();
  }
  
  this.self_user_id = getUserId();
}

Hangouts.prototype.toXml = function() {
  var smses = [];
  var mmses = [];
  
  this.conversations.forEach((function(conversation) {
    var xmlMessages = conversation.toXml();
    smses = smses.concat(xmlMessages.sms);
    mmses = mmses.concat(xmlMessages.mms);
  }).bind(this));
  
  return {
    _declaration: {
      _attributes: {
        version: "1.0",
        encoding: "utf-8",
        standalone: "yes"
      }
    },
    smses: {
      _attributes: {
        count: smses.length + mmses.length,
        backup_date: new Date().getTime()
      },
      sms: smses,
      mms: mmses
    }
  };
};

module.exports = Hangouts;
