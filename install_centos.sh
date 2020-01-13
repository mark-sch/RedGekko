#bin/bash
sudo yum -y  groupinstall 'Development Tools'
git clone https://github.com/mark-sch/RedGekko.git
sudo yum -y install python2 sqlite
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.35.2/install.sh | bash
source ~/.bashrc
cd RedGekko
nvm install 12.12
npm install
npm install tulind
sqlite3 bot.db < bot.sql
cp instance.js.dist instance.js
cp conf.json.dist conf.json