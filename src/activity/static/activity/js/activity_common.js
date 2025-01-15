var plugin_n_items = function() {
	const self = this;
    var div;

    const itemCount = function(){
        const n = self.items.length;
  	    div.innerText = `${n} item${n > 1 ? 's' : ''}`;
    }
        self.on('initialize',()=>{
        div = document.createElement('div');
        div.className = 'ts-n-items';
        self.control.append(div);
        itemCount();
    });
	self.on('item_remove',itemCount);
	self.on('item_add',itemCount);
};
TomSelect.define('n_items', plugin_n_items);