# Seeds a throwaway Redmine with what Redline needs for development and tests.
#
#   dev/redmine/seed.sh
#
# Idempotent: running it again leaves existing data alone. Prints the regular
# user's API key on the last line as REDLINE_TEST_API_KEY=<key>.
#
# Never run this against a real Redmine.

require "securerandom"

ActionMailer::Base.perform_deliveries = false
Rails.logger.level = :warn
ActiveJob::Base.logger.level = :warn if defined?(ActiveJob)

def say(msg) = puts("seed: #{msg}")

# Redmine's default trackers, statuses, priorities, roles and workflows.
if Tracker.count.zero?
  Redmine::DefaultData::Loader.load("en")
  say "loaded default configuration"
end

Setting.rest_api_enabled = "1"
Setting.text_formatting = "common_mark"
Setting.cross_project_subtasks = "tree"

admin = User.find_by(login: "admin")
if admin.must_change_passwd?
  admin.must_change_passwd = false
  admin.save!
end

# A regular, non-admin user: Redline must work with this kind of key.
user = User.find_by(login: "dev") || User.new.tap do |u|
  u.login = "dev"
  u.firstname = "Dana"
  u.lastname = "Developer"
  u.mail = "dev@example.test"
  u.password = u.password_confirmation = "redline-dev-password"
  u.admin = false
  u.status = User::STATUS_ACTIVE
  u.save!
  say "created user dev"
end

teammate = User.find_by(login: "sam") || User.new.tap do |u|
  u.login = "sam"
  u.firstname = "Sam"
  u.lastname = "Teammate"
  u.mail = "sam@example.test"
  u.password = u.password_confirmation = "redline-dev-password"
  u.status = User::STATUS_ACTIVE
  u.save!
end

developer = Role.find_by(name: "Developer") || Role.givable.first

labels = IssueCustomField.find_by(name: "Area") || IssueCustomField.create!(
  name: "Area", field_format: "list", multiple: true, is_for_all: true, is_filter: true,
  possible_values: %w[UI Sync API Docs Performance], tracker_ids: Tracker.pluck(:id)
)
size = IssueCustomField.find_by(name: "Size") || IssueCustomField.create!(
  name: "Size", field_format: "list", multiple: false, is_for_all: true, is_filter: true,
  possible_values: %w[S M L XL], tracker_ids: Tracker.pluck(:id)
)

def project_for(identifier, name, parent: nil)
  Project.find_by(identifier: identifier) || Project.new.tap do |p|
    p.identifier = identifier
    p.name = name
    p.is_public = false
    p.parent = parent if parent
    p.enabled_module_names = %w[issue_tracking time_tracking]
    p.trackers = Tracker.all
    p.save!
  end
end

web = project_for("web", "Web")
mobile = project_for("mobile", "Mobile")
design = project_for("web-design", "Design", parent: web)

[web, mobile, design].each do |project|
  [user, teammate].each do |member|
    next if Member.exists?(project: project, user: member)
    Member.create!(project: project, principal: member, roles: [developer])
  end
end

def version_for(project, name, due, status = "open")
  project.versions.find_by(name: name) ||
    project.versions.create!(name: name, effective_date: due, status: status, sharing: "none")
end

today = Date.today
past = version_for(web, "Sprint 1", today - 14)
current = version_for(web, "Sprint 2", today + 7)
version_for(web, "Sprint 3", today + 21)

if web.issues.count.zero?
  statuses = IssueStatus.sorted.to_a
  priorities = IssuePriority.active.to_a
  subjects = [
    "Command palette opens with Cmd+K",
    "Sync stops after laptop sleeps",
    "Issue list scrolls smoothly with 5,000 issues",
    "Dark mode follows the system setting",
    "Show who changed the status in the activity feed",
    "Keyboard shortcut to assign to me",
    "Markdown tables render in descriptions",
    "Retry failed edits when back online",
  ]
  User.current = user
  subjects.each_with_index do |subject, i|
    issue = Issue.new(
      project: web, tracker: Tracker.first, author: user,
      subject: subject,
      description: "## Why\n\nPart of #{['the first release', 'polish'][i % 2]}. See ##{i + 1} for context.\n\n- [ ] Design\n- [ ] Build",
      status: statuses[i % [statuses.size, 4].min],
      priority: priorities[i % priorities.size],
      assigned_to: [user, teammate, nil][i % 3],
      fixed_version: [current, current, past, nil][i % 4]
    )
    issue.custom_field_values = { labels.id.to_s => [%w[UI], %w[Sync], %w[UI Performance], %w[API]][i % 4], size.id.to_s => %w[S M L][i % 3] }
    issue.save!
  end
  first = web.issues.order(:id).first
  first.init_journal(teammate, "Looks good. @dev can you take the keyboard part?")
  first.save!
  first.init_journal(user, nil)
  first.status = IssueStatus.where(is_closed: false).second || first.status
  first.save!
  Issue.create!(project: mobile, tracker: Tracker.first, author: teammate, subject: "Offline mode for the mobile app",
                priority: priorities.first, status: statuses.first)
  # Close the past sprint once its issues are in it.
  past.update!(status: "closed")
  say "created #{Issue.count} issues"
end

# A second batch for the board, timeline, calendar and related-issue views:
# dates, sub-issues, relations and #mentions. Added once, even to older seeds.
unless web.issues.exists?(subject: "Plan the board view")
  Issue.transaction do
    User.current = user
    statuses = IssueStatus.sorted.to_a
    priorities = IssuePriority.active.to_a
    by_name = ->(name) { statuses.find { |s| s.name == name } || statuses.first }
    make = lambda do |subject, status:, start: nil, due: nil, assignee: user, version: current, parent: nil, description: nil, priority: 1|
      issue = Issue.new(
        project: web, tracker: Tracker.first, author: user, subject: subject,
        description: description, status: by_name.call(status), priority: priorities[priority % priorities.size],
        assigned_to: assignee, fixed_version: version, start_date: start, due_date: due, parent_issue_id: parent&.id
      )
      issue.custom_field_values = { labels.id.to_s => %w[UI], size.id.to_s => "M" }
      issue.save!
      issue
  end
  epic = make.call("Plan the board view", status: "In Progress", start: today - 10, due: today + 12, priority: 2,
                   description: "Kanban for every list. Follows on from the list work in #1.")
  columns = make.call("Board columns follow the list's grouping", status: "Resolved", start: today - 9, due: today - 3, parent: epic)
  drag = make.call("Drag cards between columns", status: "In Progress", start: today - 4, due: today + 3, parent: epic, assignee: teammate,
                   description: "Needs #{"#"}#{columns.id} first. Status drops must respect the workflow.")
  keys = make.call("Move cards with the keyboard", status: "New", start: today + 2, due: today + 6, parent: epic)
  timeline = make.call("Timeline view with dependencies", status: "New", start: today + 5, due: today + 16, version: nil, priority: 3)
  calendar = make.call("Calendar view of due dates", status: "Feedback", due: today + 9, assignee: teammate)
  make.call("Fix overlapping cards on narrow windows", status: "New", due: today - 2, priority: 3,
            description: "Seen while testing #{"#"}#{drag.id}.")
  make.call("Empty columns can be hidden", status: "Closed", start: today - 12, due: today - 8, version: nil)
  make.call("Show blocked issues on cards", status: "New", assignee: nil, version: nil, priority: 0)
  make.call("Board remembers its columns per list", status: "Rejected", version: nil, assignee: teammate)
  IssueRelation.create!(issue_from: columns, issue_to: drag, relation_type: "precedes")
  IssueRelation.create!(issue_from: drag, issue_to: keys, relation_type: "blocks")
  IssueRelation.create!(issue_from: timeline, issue_to: calendar, relation_type: "relates")
  drag.init_journal(teammate, "Started on this. The shell may need pointer events, see #{"#"}#{keys.id}.")
  drag.save!
  end
  say "added board and timeline issues"
end

token = Token.find_by(user: user, action: "api") || Token.create!(user: user, action: "api")
puts "REDLINE_TEST_API_KEY=#{token.value}"
