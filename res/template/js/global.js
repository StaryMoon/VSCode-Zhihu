const favoriteBtn = document.getElementById('favorite');
const shareBtn = document.getElementById('share');
const openBtn = document.getElementById('open');
const upvoteCode = document.getElementById('upvote');
const vscode = acquireVsCodeApi();

function postCommand(command, payload = {}) {
	vscode.postMessage(Object.assign({ command }, payload));
}

function answerUpvote(id) {
	postCommand('upvoteAnswer', { id: id });
}

function articleUpvote(id) {
	postCommand('upvoteArticle', { id: id });
}

if (favoriteBtn) {
	favoriteBtn.addEventListener('click', () => {
		postCommand('collect');
	});
}

if (shareBtn) {
	shareBtn.addEventListener('click', () => {
		postCommand('share');
	});
}

if (openBtn) {
	openBtn.addEventListener('click', () => {
		postCommand('open');
	});
}

document.querySelectorAll('[data-command]').forEach(button => {
	button.addEventListener('click', () => {
		postCommand(button.getAttribute('data-command'), {
			id: button.getAttribute('data-item-id'),
			itemType: button.getAttribute('data-item-type')
		});
	});
});



